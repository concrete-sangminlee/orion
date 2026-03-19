/**
 * Orion CLI - Update Command
 * Self-update: check npm registry for latest version, compare, and install.
 *
 * Usage:
 *   orion update           # Check and install latest version
 *   orion update --check   # Check only, don't install
 */

import { execSync } from 'child_process';
import chalk from 'chalk';
import {
  colors,
  printHeader,
  printSuccess,
  printError,
  printInfo,
  printWarning,
  startSpinner,
  stopSpinner,
} from '../utils.js';
import { commandHeader, divider, statusLine, badge, keyValue, palette } from '../ui.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const PACKAGE_NAME = 'orion-ide';
const CURRENT_VERSION = '2.0.0';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseVersion(version: string): { major: number; minor: number; patch: number } | null {
  const match = version.trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
  };
}

function isNewer(latest: string, current: string): boolean {
  const l = parseVersion(latest);
  const c = parseVersion(current);
  if (!l || !c) return false;
  if (l.major !== c.major) return l.major > c.major;
  if (l.minor !== c.minor) return l.minor > c.minor;
  return l.patch > c.patch;
}

function fetchLatestVersion(): string | null {
  try {
    const result = execSync(`npm view ${PACKAGE_NAME} version`, {
      encoding: 'utf-8',
      timeout: 15000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return result.trim();
  } catch {
    return null;
  }
}

function fetchChangelog(from: string, to: string): string[] | null {
  try {
    // Try fetching version-specific info from npm
    const result = execSync(`npm view ${PACKAGE_NAME} versions --json`, {
      encoding: 'utf-8',
      timeout: 15000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const versions: string[] = JSON.parse(result);
    const fromParsed = parseVersion(from);
    const toParsed = parseVersion(to);
    if (!fromParsed || !toParsed) return null;

    // Collect versions between from and to
    const between = versions.filter(v => {
      return isNewer(v, from) && !isNewer(v, to) || v === to;
    });

    if (between.length === 0) return null;
    return between.map(v => `  ${palette.dim('\u2022')} ${v}`);
  } catch {
    return null;
  }
}

function runInstall(): boolean {
  try {
    execSync(`npm install -g ${PACKAGE_NAME}@latest`, {
      encoding: 'utf-8',
      timeout: 120000,
      stdio: 'inherit',
    });
    return true;
  } catch {
    return false;
  }
}

// ─── Command ─────────────────────────────────────────────────────────────────

export async function updateCommand(options?: { check?: boolean }): Promise<void> {
  const checkOnly = options?.check || false;

  console.log(commandHeader('Update', [
    ['Package', PACKAGE_NAME],
    ['Current', `v${CURRENT_VERSION}`],
    ['Mode', checkOnly ? 'Check only' : 'Check & install'],
  ]));

  // Step 1: Check npm registry
  const spinner = startSpinner('Checking npm registry for latest version...');

  const latestVersion = fetchLatestVersion();

  if (!latestVersion) {
    stopSpinner(spinner, 'Could not reach npm registry', false);
    console.log();
    printError('Failed to fetch version info from npm.');
    printInfo('Check your network connection and try again.');
    printInfo(`You can also update manually: ${colors.command(`npm install -g ${PACKAGE_NAME}@latest`)}`);
    console.log();
    return;
  }

  stopSpinner(spinner, 'Version check complete', true);
  console.log();

  // Step 2: Compare versions
  console.log(keyValue([
    ['Installed', `v${CURRENT_VERSION}`],
    ['Latest', `v${latestVersion}`],
  ]));
  console.log();

  if (!isNewer(latestVersion, CURRENT_VERSION)) {
    // Already up to date
    printSuccess(`You are already on the latest version (v${CURRENT_VERSION}).`);
    console.log();
    return;
  }

  // Newer version available
  const updateBadge = badge('UPDATE', '#F59E0B');
  console.log(`  ${updateBadge}  v${CURRENT_VERSION} ${palette.dim('\u2192')} v${latestVersion}`);
  console.log();

  // Step 3: Show changelog if possible
  const changelog = fetchChangelog(CURRENT_VERSION, latestVersion);
  if (changelog && changelog.length > 0) {
    console.log(divider('Versions between'));
    console.log();
    for (const line of changelog) {
      console.log(line);
    }
    console.log();
    console.log(divider());
    console.log();
  }

  // Step 4: Install or just report
  if (checkOnly) {
    printInfo(`Update available: v${CURRENT_VERSION} \u2192 v${latestVersion}`);
    printInfo(`Run ${colors.command('orion update')} to install.`);
    console.log();
    return;
  }

  // Perform the update
  console.log();
  const installSpinner = startSpinner(`Installing ${PACKAGE_NAME}@latest...`);

  const success = runInstall();

  if (success) {
    stopSpinner(installSpinner, `Updated to v${latestVersion}`, true);
    console.log();
    printSuccess(`Orion has been updated to v${latestVersion}.`);
    printInfo('Restart your terminal to use the new version.');
  } else {
    stopSpinner(installSpinner, 'Installation failed', false);
    console.log();
    printError('Failed to install the update.');
    printWarning('You may need elevated permissions. Try:');
    printInfo(`  ${colors.command(`sudo npm install -g ${PACKAGE_NAME}@latest`)}`);
    printInfo(`  ${colors.command(`npm install -g ${PACKAGE_NAME}@latest --force`)}`);
  }

  console.log();
}
