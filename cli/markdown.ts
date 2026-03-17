/**
 * Orion CLI - Markdown Rendering for Terminal
 * Parses AI markdown responses and renders them with rich formatting.
 * Uses marked + marked-terminal + chalk for premium terminal output.
 */

import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import chalk from 'chalk';

// ─── Configure marked with terminal renderer ────────────────────────────────

marked.use(
  markedTerminal({
    // Code blocks: yellow text
    code: chalk.yellow,

    // Inline code
    codespan: chalk.bgGray.white,

    // Bold
    strong: chalk.bold.white,

    // Italic
    em: chalk.italic.cyan,

    // Headings
    firstHeading: chalk.hex('#B39DDB').underline.bold,
    heading: chalk.hex('#90CAF9').bold,

    // Blockquotes
    blockquote: chalk.gray.italic,

    // Lists
    listitem: chalk.reset,

    // Links
    link: chalk.cyan.underline,
    href: chalk.dim,

    // Horizontal rules
    hr: chalk.dim,

    // Paragraphs
    paragraph: chalk.reset,

    // Strikethrough
    del: chalk.dim.gray.strikethrough,

    // Tables
    table: chalk.reset,

    // Text
    text: chalk.reset,

    // Settings
    unescape: true,
    emoji: false,
    width: 76,
    showSectionPrefix: true,
    reflowText: false,
    tab: 2,
  })
);

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Render a markdown string to beautifully formatted terminal output.
 * Handles bold, italic, code blocks, headers, lists, blockquotes, etc.
 */
export function renderMarkdown(text: string): string {
  if (!text || !text.trim()) return '';

  try {
    // Parse and render markdown
    let rendered = marked.parse(text, { async: false }) as string;

    // Clean up excessive blank lines (3+ blank lines -> 2)
    rendered = rendered.replace(/\n{4,}/g, '\n\n\n');

    // Trim trailing whitespace
    rendered = rendered.trimEnd();

    return rendered;
  } catch {
    // Fallback: return the text with basic indentation
    return text.split('\n').map(line => '  ' + line).join('\n');
  }
}

/**
 * Render markdown and immediately write to stdout.
 */
export function printMarkdown(text: string): void {
  const rendered = renderMarkdown(text);
  if (rendered) {
    console.log(rendered);
  }
}
