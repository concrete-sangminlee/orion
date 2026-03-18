/**
 * Orion CLI - Markdown Rendering for Terminal
 * Parses AI markdown responses and renders them with rich formatting.
 * Uses marked + marked-terminal + chalk for premium terminal output.
 *
 * Design: Purple gradient headings, boxed code blocks, triangle bullets,
 * left-bordered blockquotes. Inspired by Warp and Claude Code aesthetics.
 */

import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import chalk from 'chalk';

// ─── Color Palette ──────────────────────────────────────────────────────────

const purple = chalk.hex('#9B59B6');
const violet = chalk.hex('#7C5CFC');
const blue = chalk.hex('#38BDF8');
const dm = chalk.dim;

// ─── Configure marked with terminal renderer ────────────────────────────────

marked.use(
  markedTerminal({
    // Code blocks: use a clean dim style
    code: chalk.hex('#E2E8F0'),

    // Inline code: dark bg + white text
    codespan: chalk.bgHex('#2D2D2D').hex('#E2E8F0'),

    // Bold
    strong: chalk.bold.white,

    // Italic
    em: chalk.italic.hex('#38BDF8'),

    // Headings: purple gradient
    firstHeading: chalk.hex('#9B59B6').bold.underline,
    heading: chalk.hex('#7C5CFC').bold,

    // Blockquotes: dim italic (left border handled by marked-terminal)
    blockquote: chalk.hex('#9B59B6').dim.italic,

    // Lists: triangle bullet
    listitem: chalk.reset,

    // Links
    link: blue.underline,
    href: dm,

    // Horizontal rules
    hr: dm,

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
    showSectionPrefix: false,
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
