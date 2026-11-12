/**
 * Orion CLI - Git Hooks Integration Command
 * Install, uninstall, and manage Orion-powered git hooks.
 *
 * Supported hooks:
 *   pre-commit  - Runs `orion diff --staged` on staged changes (advisory)
 *   commit-msg  - Validates commit message format with AI
 *   pre-push    - Runs an `orion security` scan (advisory)
 *
 * Usage:
 *   orion hooks install                # Install all Orion git hooks
 *   orion hooks install --hook pre-commit  # Install a specific hook
 *   orion hooks uninstall              # Remove all Orion git hooks
 *   orion hooks uninstall --hook pre-push  # Remove a specific hook
 *   orion hooks list                   # Show installed hooks
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import {
  colors,
  printSuccess,
  printError,
  printWarning,
  printInfo,
} from '../utils.js';
import { commandHeader, statusLine, divider, palette } from '../ui.js';

// ─── Constants ──────────────────────────────────────────────────────────────

const ORION_MARKER = '# ORION-MANAGED-HOOK';

interface HookDefinition {
  name: string;
  description: string;
  script: string;
}

// The pre-commit and pre-push hooks are advisory: `orion diff` and
// `orion security` exit 0 whatever they find, so a non-zero status only means
// the CLI itself failed (no AI provider, not installed) and must not block git.
const HOOK_DEFINITIONS: HookDefinition[] = [
  {
    name: 'pre-commit',
    description: 'Show an AI review of staged changes before committing (advisory)',
    script: `#!/bin/sh
${ORION_MARKER}
# Orion pre-commit hook
# Shows an AI review of the staged changes. Advisory: never blocks the commit.

STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM)
if [ -z "$STAGED_FILES" ]; then
  exit 0
fi

echo "Orion: reviewing staged changes..."
if ! orion diff --staged; then
  echo "Orion: the review could not run (see above). Committing anyway."
fi

exit 0
`,
  },
  {
    name: 'commit-msg',
    description: 'Validate commit message format with AI',
    script: `#!/bin/sh
${ORION_MARKER}
# Orion commit-msg hook
# Validates the commit message format using AI analysis.

COMMIT_MSG_FILE="$1"
if [ ! -f "$COMMIT_MSG_FILE" ]; then
  exit 0
fi

COMMIT_MSG=$(cat "$COMMIT_MSG_FILE")

# Skip merge commits and fixup commits
case "$COMMIT_MSG" in
  Merge*|fixup!*|squash!*|amend!*)
    exit 0
    ;;
esac

# Skip very short messages (likely interactive rebase)
MSG_LEN=$(echo "$COMMIT_MSG" | head -1 | wc -c)
if [ "$MSG_LEN" -lt 5 ]; then
  exit 0
fi

echo "Orion: validating commit message..."
echo "$COMMIT_MSG" | orion ask "Validate this commit message. Is it clear, descriptive, and following conventional commit format? Reply with PASS or FAIL followed by a brief reason." --quiet 2>/dev/null
EXIT_CODE=$?

# Non-blocking: always allow the commit, just warn
if [ $EXIT_CODE -ne 0 ]; then
  echo "Orion: could not validate commit message (AI unavailable). Proceeding."
fi

exit 0
`,
  },
  {
    name: 'pre-push',
    description: 'Show a security scan before pushing (advisory)',
    script: `#!/bin/sh
${ORION_MARKER}
# Orion pre-push hook
# Shows a security scan when files changed since the remote tracking branch.
# Advisory: never blocks the push.

REMOTE="$1"

# Get the current branch
BRANCH=$(git rev-parse --abbrev-ref HEAD)

# Find changed files compared to remote
CHANGED_FILES=$(git diff --name-only "$REMOTE/$BRANCH" HEAD 2>/dev/null)
if [ -z "$CHANGED_FILES" ]; then
  # Fallback: compare against origin/main
  CHANGED_FILES=$(git diff --name-only origin/main HEAD 2>/dev/null)
fi

if [ -z "$CHANGED_FILES" ]; then
  exit 0
fi

echo "Orion: running security scan before push..."
if ! orion security; then
  echo "Orion: the security scan could not run (see above). Pushing anyway."
fi

exit 0
`,
  },
];

const VALID_HOOK_NAMES = HOOK_DEFINITIONS.map((h) => h.name);

// ─── Git Helpers ────────────────────────────────────────────────────────────

function findGitDir(): string | null {
  try {
    const gitDir = execSync('git rev-parse --git-dir', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return path.resolve(gitDir);
  } catch {
    return null;
  }
}

function getHooksDir(gitDir: string): string {
  return path.join(gitDir, 'hooks');
}

function isOrionHook(hookPath: string): boolean {
  try {
    if (!fs.existsSync(hookPath)) return false;
    const content = fs.readFileSync(hookPath, 'utf-8');
    return content.includes(ORION_MARKER);
  } catch {
    return false;
  }
}

// ─── Install ────────────────────────────────────────────────────────────────

function installHook(hooksDir: string, hook: HookDefinition, force: boolean): boolean {
  const hookPath = path.join(hooksDir, hook.name);

  // Check if a non-Orion hook already exists
  if (fs.existsSync(hookPath) && !isOrionHook(hookPath)) {
    if (!force) {
      printWarning(
        `Existing ${colors.command(hook.name)} hook found (not managed by Orion). Use --force to overwrite.`
      );
      return false;
    }
    // Backup existing hook
    const backupPath = hookPath + '.orion-backup';
    fs.copyFileSync(hookPath, backupPath);
    printInfo(`Backed up existing ${hook.name} hook to ${path.basename(backupPath)}`);
  }

  fs.writeFileSync(hookPath, hook.script, { mode: 0o755 });
  printSuccess(`Installed ${colors.command(hook.name)} hook: ${palette.dim(hook.description)}`);
  return true;
}

function installHooks(hooksDir: string, hookName?: string, force = false): void {
  if (!fs.existsSync(hooksDir)) {
    fs.mkdirSync(hooksDir, { recursive: true });
  }

  const hooks = hookName
    ? HOOK_DEFINITIONS.filter((h) => h.name === hookName)
    : HOOK_DEFINITIONS;

  if (hookName && hooks.length === 0) {
    printError(`Unknown hook: ${colors.command(hookName)}`);
    printInfo(`Valid hooks: ${VALID_HOOK_NAMES.map((n) => colors.command(n)).join(', ')}`);
    return;
  }

  let installed = 0;
  for (const hook of hooks) {
    if (installHook(hooksDir, hook, force)) {
      installed++;
    }
  }

  console.log();
  if (installed > 0) {
    printSuccess(`${installed} hook${installed > 1 ? 's' : ''} installed in ${palette.dim(hooksDir)}`);
  } else {
    printWarning('No hooks were installed.');
  }
}

// ─── Uninstall ──────────────────────────────────────────────────────────────

function uninstallHooks(hooksDir: string, hookName?: string): void {
  const hooks = hookName
    ? HOOK_DEFINITIONS.filter((h) => h.name === hookName)
    : HOOK_DEFINITIONS;

  if (hookName && hooks.length === 0) {
    printError(`Unknown hook: ${colors.command(hookName)}`);
    printInfo(`Valid hooks: ${VALID_HOOK_NAMES.map((n) => colors.command(n)).join(', ')}`);
    return;
  }

  let removed = 0;
  for (const hook of hooks) {
    const hookPath = path.join(hooksDir, hook.name);

    if (!fs.existsSync(hookPath)) {
      printInfo(`${colors.command(hook.name)} hook not found, skipping.`);
      continue;
    }

    if (!isOrionHook(hookPath)) {
      printWarning(`${colors.command(hook.name)} hook exists but is not managed by Orion. Skipping.`);
      continue;
    }

    fs.unlinkSync(hookPath);
    printSuccess(`Removed ${colors.command(hook.name)} hook.`);
    removed++;

    // Restore backup if it exists
    const backupPath = hookPath + '.orion-backup';
    if (fs.existsSync(backupPath)) {
      fs.renameSync(backupPath, hookPath);
      printInfo(`Restored original ${hook.name} hook from backup.`);
    }
  }

  console.log();
  if (removed > 0) {
    printSuccess(`${removed} hook${removed > 1 ? 's' : ''} removed.`);
  } else {
    printInfo('No Orion hooks were found to remove.');
  }
}

// ─── List ───────────────────────────────────────────────────────────────────

function listHooks(hooksDir: string): void {
  console.log(commandHeader('Git Hooks', [['hooks dir', hooksDir]]));
  console.log();

  let anyFound = false;

  for (const hook of HOOK_DEFINITIONS) {
    const hookPath = path.join(hooksDir, hook.name);
    const exists = fs.existsSync(hookPath);
    const isOrion = exists && isOrionHook(hookPath);

    let status: string;
    let icon: '\u2713' | '\u25CB' | '!';

    if (isOrion) {
      status = palette.green('active') + palette.dim(' (orion-managed)');
      icon = '\u2713';
      anyFound = true;
    } else if (exists) {
      status = palette.yellow('exists') + palette.dim(' (external)');
      icon = '!';
    } else {
      status = palette.dim('not installed');
      icon = '\u25CB';
    }

    console.log(statusLine(icon, `${colors.command(hook.name.padEnd(14))} ${status}`));
    console.log(`    ${palette.dim(hook.description)}`);
  }

  console.log();
  if (!anyFound) {
    printInfo(`Run ${colors.command('orion hooks install')} to set up git hooks.`);
  }
  console.log(divider());
  console.log();
}

// ─── Main Export ────────────────────────────────────────────────────────────

export interface HooksOptions {
  hook?: string;
  force?: boolean;
}

export async function hooksCommand(
  action: string,
  options: HooksOptions = {}
): Promise<void> {
  const gitDir = findGitDir();
  if (!gitDir) {
    printError('Not a git repository. Run this command from inside a git project.');
    process.exit(1);
  }

  const hooksDir = getHooksDir(gitDir);

  switch (action) {
    case 'install':
      console.log(commandHeader('Install Git Hooks'));
      console.log();
      installHooks(hooksDir, options.hook, options.force);
      console.log();
      break;

    case 'uninstall':
      console.log(commandHeader('Uninstall Git Hooks'));
      console.log();
      uninstallHooks(hooksDir, options.hook);
      console.log();
      break;

    case 'list':
      listHooks(hooksDir);
      break;

    default:
      printError(`Unknown action: ${colors.command(action)}`);
      printInfo('Usage: orion hooks <install|uninstall|list>');
      console.log();
      process.exit(1);
  }
}
