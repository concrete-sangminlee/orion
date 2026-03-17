/**
 * Orion CLI - Project Memory / Context Command
 * Manages .orion/context.md for project-level AI context (like CLAUDE.md)
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import {
  colors,
  printHeader,
  printInfo,
  printSuccess,
  printWarning,
} from '../utils.js';

const CONTEXT_TEMPLATE = `# Project Context

## Architecture
<!-- Describe your project architecture here -->

## Coding Standards
<!-- Coding conventions, formatting rules, etc. -->

## Common Commands
<!-- Frequently used commands -->

## Notes
<!-- Any other context for the AI -->
`;

/**
 * Creates the .orion/ directory and context.md file in the current project.
 * Called during `orion init`.
 */
export function initProjectContext(): void {
  const orionDir = path.join(process.cwd(), '.orion');
  const contextFile = path.join(orionDir, 'context.md');

  // Create .orion/ directory
  if (!fs.existsSync(orionDir)) {
    fs.mkdirSync(orionDir, { recursive: true });
    printSuccess(`Created ${colors.file('.orion/')} directory`);
  } else {
    printInfo(`${colors.file('.orion/')} directory already exists`);
  }

  // Create context.md with template
  if (!fs.existsSync(contextFile)) {
    fs.writeFileSync(contextFile, CONTEXT_TEMPLATE, 'utf-8');
    printSuccess(`Created ${colors.file('.orion/context.md')} with default template`);
  } else {
    printWarning(`${colors.file('.orion/context.md')} already exists, skipping`);
  }
}
