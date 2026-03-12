// Settings Sync System — export/import, profiles, conflict resolution, auto-backup, encryption

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SyncCategory =
  | 'settings'
  | 'keybindings'
  | 'themes'
  | 'extensions'
  | 'snippets'
  | 'profiles'
  | 'uiState';

export const ALL_SYNC_CATEGORIES: SyncCategory[] = [
  'settings',
  'keybindings',
  'themes',
  'extensions',
  'snippets',
  'profiles',
  'uiState',
];

export interface SyncBundle {
  version: number;
  timestamp: number;
  machine: string;
  categories: SyncCategory[];
  data: Record<SyncCategory, Record<string, unknown>>;
  encrypted?: Record<string, string>; // category.key -> encrypted blob
}

export interface SyncConflict {
  category: SyncCategory;
  key: string;
  localValue: unknown;
  remoteValue: unknown;
  resolution?: 'local' | 'remote' | 'merge';
}

export interface SyncProfile {
  id: string;
  name: string;
  description: string;
  categories: SyncCategory[];
  lastSynced: number;
  bundleSnapshot?: SyncBundle;
}

export interface SyncDiff {
  category: SyncCategory;
  key: string;
  action: 'add' | 'remove' | 'modify';
  oldValue: unknown;
  newValue: unknown;
}

interface BackupEntry {
  timestamp: number;
  size: number;
  bundleJson: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_PREFIX = 'settingsSync';
const KEY_SETTINGS = `${STORAGE_PREFIX}:data`;
const KEY_PROFILES = `${STORAGE_PREFIX}:profiles`;
const KEY_BACKUPS = `${STORAGE_PREFIX}:backups`;
const KEY_MACHINE_ID = `${STORAGE_PREFIX}:machineId`;

const CURRENT_BUNDLE_VERSION = 1;
const MAX_BACKUPS = 20;

// Sensitive key patterns — values matching these paths get encrypted in bundles
const SENSITIVE_PATTERNS = [
  /apiKey/i,
  /token/i,
  /secret/i,
  /password/i,
  /credential/i,
  /privateKey/i,
];

// ---------------------------------------------------------------------------
// Helpers — localStorage wrappers
// ---------------------------------------------------------------------------

function storageGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function storageSet(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.error(`[settingsSync] Failed to write ${key}:`, err);
  }
}

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function getMachineId(): string {
  let id = storageGet<string | null>(KEY_MACHINE_ID, null);
  if (!id) {
    id = `machine-${generateId()}`;
    storageSet(KEY_MACHINE_ID, id);
  }
  return id;
}

function isSensitiveKey(category: SyncCategory, key: string): boolean {
  const path = `${category}.${key}`;
  return SENSITIVE_PATTERNS.some((pat) => pat.test(path));
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target };
  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const tgtVal = target[key];
    if (
      srcVal !== null &&
      typeof srcVal === 'object' &&
      !Array.isArray(srcVal) &&
      tgtVal !== null &&
      typeof tgtVal === 'object' &&
      !Array.isArray(tgtVal)
    ) {
      result[key] = deepMerge(
        tgtVal as Record<string, unknown>,
        srcVal as Record<string, unknown>,
      );
    } else {
      result[key] = srcVal;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Encryption helpers (simple XOR-based obfuscation for localStorage use)
// ---------------------------------------------------------------------------

/**
 * Encrypt a plaintext string using a repeating-key XOR cipher and return a
 * base-64 encoded result.  This is NOT cryptographically secure — it is
 * intended only to prevent casual inspection of sensitive values stored in
 * localStorage.  For real security, use the Web Crypto API or a backend.
 */
export function encryptSensitive(data: string, key: string): string {
  if (!key) return data;
  const encoded: number[] = [];
  for (let i = 0; i < data.length; i++) {
    const charCode = data.charCodeAt(i) ^ key.charCodeAt(i % key.length);
    encoded.push(charCode);
  }
  // Convert to a base-64 string that is safe for JSON storage
  return btoa(String.fromCharCode(...encoded));
}

/**
 * Decrypt a value that was encrypted with {@link encryptSensitive}.
 */
export function decryptSensitive(encrypted: string, key: string): string {
  if (!key) return encrypted;
  try {
    const decoded = atob(encrypted);
    const chars: string[] = [];
    for (let i = 0; i < decoded.length; i++) {
      const charCode = decoded.charCodeAt(i) ^ key.charCodeAt(i % key.length);
      chars.push(String.fromCharCode(charCode));
    }
    return chars.join('');
  } catch {
    console.warn('[settingsSync] Decryption failed — returning raw value');
    return encrypted;
  }
}

// ---------------------------------------------------------------------------
// Core data access — read/write per-category settings in localStorage
// ---------------------------------------------------------------------------

function readAllSettings(): Record<SyncCategory, Record<string, unknown>> {
  const empty = (): Record<SyncCategory, Record<string, unknown>> => {
    const base = {} as Record<SyncCategory, Record<string, unknown>>;
    for (const cat of ALL_SYNC_CATEGORIES) {
      base[cat] = {};
    }
    return base;
  };
  return storageGet(KEY_SETTINGS, empty());
}

function writeAllSettings(data: Record<SyncCategory, Record<string, unknown>>): void {
  storageSet(KEY_SETTINGS, data);
}

function readCategorySettings(category: SyncCategory): Record<string, unknown> {
  const all = readAllSettings();
  return all[category] ?? {};
}

function writeCategorySettings(category: SyncCategory, data: Record<string, unknown>): void {
  const all = readAllSettings();
  all[category] = data;
  writeAllSettings(all);
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/**
 * Export the current settings as a {@link SyncBundle}.  Pass a subset of
 * categories to perform a selective export; by default all categories are
 * included.
 */
export function exportSettings(categories?: SyncCategory[]): SyncBundle {
  const cats = categories ?? ALL_SYNC_CATEGORIES;
  const allData = readAllSettings();
  const data = {} as Record<SyncCategory, Record<string, unknown>>;
  const encrypted: Record<string, string> = {};

  for (const cat of cats) {
    const catData = allData[cat] ?? {};
    const safeCopy: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(catData)) {
      if (isSensitiveKey(cat, key) && typeof value === 'string') {
        // Replace with placeholder; store encrypted blob separately
        safeCopy[key] = '***encrypted***';
        encrypted[`${cat}.${key}`] = encryptSensitive(value, getMachineId());
      } else {
        safeCopy[key] = value;
      }
    }
    data[cat] = safeCopy;
  }

  return {
    version: CURRENT_BUNDLE_VERSION,
    timestamp: Date.now(),
    machine: getMachineId(),
    categories: cats,
    data,
    ...(Object.keys(encrypted).length > 0 ? { encrypted } : {}),
  };
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

/**
 * Compute a list of diffs that describe what would change if `remote` were
 * applied on top of `local`.
 */
export function diffBundles(local: SyncBundle, remote: SyncBundle): SyncDiff[] {
  const diffs: SyncDiff[] = [];
  const categories = Array.from(new Set([...local.categories, ...remote.categories]));

  for (const cat of categories) {
    const localCat = local.data[cat] ?? {};
    const remoteCat = remote.data[cat] ?? {};

    const allKeys = new Set([...Object.keys(localCat), ...Object.keys(remoteCat)]);

    for (const key of allKeys) {
      const inLocal = key in localCat;
      const inRemote = key in remoteCat;

      if (inRemote && !inLocal) {
        diffs.push({ category: cat, key, action: 'add', oldValue: undefined, newValue: remoteCat[key] });
      } else if (inLocal && !inRemote) {
        diffs.push({ category: cat, key, action: 'remove', oldValue: localCat[key], newValue: undefined });
      } else if (inLocal && inRemote) {
        const lv = JSON.stringify(localCat[key]);
        const rv = JSON.stringify(remoteCat[key]);
        if (lv !== rv) {
          diffs.push({ category: cat, key, action: 'modify', oldValue: localCat[key], newValue: remoteCat[key] });
        }
      }
    }
  }

  return diffs;
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

/**
 * Import a settings bundle.  Returns a list of conflicts encountered.
 *
 * - `'replace'` — overwrite local with remote for all categories in the bundle.
 * - `'keepLocal'` — only add keys that do not exist locally; never overwrite.
 * - `'merge'` — deep-merge remote into local; conflicts are returned for the
 *    caller to resolve via {@link resolveConflict}.
 */
export function importSettings(
  bundle: SyncBundle,
  strategy: 'merge' | 'replace' | 'keepLocal' = 'merge',
): SyncConflict[] {
  if (bundle.version > CURRENT_BUNDLE_VERSION) {
    console.warn(
      `[settingsSync] Bundle version ${bundle.version} is newer than supported (${CURRENT_BUNDLE_VERSION})`,
    );
  }

  const conflicts: SyncConflict[] = [];
  const localBundle = exportSettings(bundle.categories);

  for (const cat of bundle.categories) {
    const localCat = localBundle.data[cat] ?? {};
    const remoteCat = bundle.data[cat] ?? {};

    if (strategy === 'replace') {
      writeCategorySettings(cat, { ...remoteCat });
      continue;
    }

    if (strategy === 'keepLocal') {
      const merged = { ...localCat };
      for (const [key, value] of Object.entries(remoteCat)) {
        if (!(key in merged)) {
          merged[key] = value;
        }
      }
      writeCategorySettings(cat, merged);
      continue;
    }

    // strategy === 'merge'
    const merged: Record<string, unknown> = { ...localCat };

    for (const [key, remoteValue] of Object.entries(remoteCat)) {
      const localValue = localCat[key];
      const localJson = JSON.stringify(localValue);
      const remoteJson = JSON.stringify(remoteValue);

      if (localValue === undefined) {
        // New key from remote — just add it
        merged[key] = remoteValue;
      } else if (localJson === remoteJson) {
        // Identical — nothing to do
      } else if (
        typeof localValue === 'object' &&
        typeof remoteValue === 'object' &&
        localValue !== null &&
        remoteValue !== null &&
        !Array.isArray(localValue) &&
        !Array.isArray(remoteValue)
      ) {
        // Both are objects — attempt deep merge
        merged[key] = deepMerge(
          localValue as Record<string, unknown>,
          remoteValue as Record<string, unknown>,
        );
      } else {
        // Scalar conflict
        conflicts.push({ category: cat, key, localValue, remoteValue });
        // Leave local value in place until conflict is resolved
      }
    }

    writeCategorySettings(cat, merged);
  }

  return conflicts;
}

// ---------------------------------------------------------------------------
// Conflict resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a single conflict that was returned from {@link importSettings}.
 */
export function resolveConflict(
  conflict: SyncConflict,
  resolution: 'local' | 'remote' | 'merge',
): void {
  conflict.resolution = resolution;
  const catData = readCategorySettings(conflict.category);

  switch (resolution) {
    case 'local':
      catData[conflict.key] = conflict.localValue;
      break;
    case 'remote':
      catData[conflict.key] = conflict.remoteValue;
      break;
    case 'merge': {
      // Attempt to merge; for primitives, prefer remote
      const lv = conflict.localValue;
      const rv = conflict.remoteValue;
      if (
        typeof lv === 'object' && lv !== null && !Array.isArray(lv) &&
        typeof rv === 'object' && rv !== null && !Array.isArray(rv)
      ) {
        catData[conflict.key] = deepMerge(
          lv as Record<string, unknown>,
          rv as Record<string, unknown>,
        );
      } else if (Array.isArray(lv) && Array.isArray(rv)) {
        // Union arrays, deduplicate via JSON
        const seen = new Set(lv.map((v) => JSON.stringify(v)));
        const union = [...lv];
        for (const item of rv) {
          const s = JSON.stringify(item);
          if (!seen.has(s)) {
            union.push(item);
            seen.add(s);
          }
        }
        catData[conflict.key] = union;
      } else {
        // Fallback: prefer remote
        catData[conflict.key] = rv;
      }
      break;
    }
  }

  writeCategorySettings(conflict.category, catData);
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

function readProfiles(): SyncProfile[] {
  return storageGet<SyncProfile[]>(KEY_PROFILES, []);
}

function writeProfiles(profiles: SyncProfile[]): void {
  storageSet(KEY_PROFILES, profiles);
}

/**
 * Create a named profile that captures the current state of the given
 * categories.
 */
export function createProfile(name: string, categories: SyncCategory[]): SyncProfile {
  const profiles = readProfiles();
  const profile: SyncProfile = {
    id: generateId(),
    name,
    description: '',
    categories,
    lastSynced: Date.now(),
    bundleSnapshot: exportSettings(categories),
  };
  profiles.push(profile);
  writeProfiles(profiles);
  return profile;
}

/**
 * Apply a previously saved profile, replacing the relevant categories with the
 * snapshot stored in the profile.
 */
export function applyProfile(profileId: string): void {
  const profiles = readProfiles();
  const profile = profiles.find((p) => p.id === profileId);
  if (!profile) {
    console.warn(`[settingsSync] Profile ${profileId} not found`);
    return;
  }

  if (!profile.bundleSnapshot) {
    console.warn(`[settingsSync] Profile ${profileId} has no snapshot`);
    return;
  }

  // Create a backup before applying
  autoBackup();

  importSettings(profile.bundleSnapshot, 'replace');

  // Update lastSynced
  profile.lastSynced = Date.now();
  writeProfiles(profiles);
}

/**
 * List all saved profiles.
 */
export function listProfiles(): SyncProfile[] {
  return readProfiles();
}

/**
 * Delete a profile by id.
 */
export function deleteProfile(profileId: string): boolean {
  const profiles = readProfiles();
  const idx = profiles.findIndex((p) => p.id === profileId);
  if (idx === -1) return false;
  profiles.splice(idx, 1);
  writeProfiles(profiles);
  return true;
}

/**
 * Update an existing profile's snapshot to match the current settings.
 */
export function updateProfile(profileId: string): SyncProfile | null {
  const profiles = readProfiles();
  const profile = profiles.find((p) => p.id === profileId);
  if (!profile) return null;

  profile.bundleSnapshot = exportSettings(profile.categories);
  profile.lastSynced = Date.now();
  writeProfiles(profiles);
  return profile;
}

// ---------------------------------------------------------------------------
// Backups
// ---------------------------------------------------------------------------

function readBackups(): BackupEntry[] {
  return storageGet<BackupEntry[]>(KEY_BACKUPS, []);
}

function writeBackups(backups: BackupEntry[]): void {
  storageSet(KEY_BACKUPS, backups);
}

/**
 * Create an automatic backup of the current settings.  Old backups beyond
 * {@link MAX_BACKUPS} are pruned.
 */
export function autoBackup(): void {
  const bundle = exportSettings();
  const json = JSON.stringify(bundle);
  const backups = readBackups();

  backups.push({
    timestamp: Date.now(),
    size: json.length,
    bundleJson: json,
  });

  // Prune oldest
  while (backups.length > MAX_BACKUPS) {
    backups.shift();
  }

  writeBackups(backups);
}

/**
 * Restore settings from a backup taken at the given timestamp.  Returns the
 * bundle if found, or `null` otherwise.
 */
export function restoreFromBackup(timestamp: number): SyncBundle | null {
  const backups = readBackups();
  const entry = backups.find((b) => b.timestamp === timestamp);
  if (!entry) return null;

  try {
    const bundle = JSON.parse(entry.bundleJson) as SyncBundle;
    importSettings(bundle, 'replace');
    return bundle;
  } catch {
    console.error('[settingsSync] Failed to parse backup');
    return null;
  }
}

/**
 * Return metadata for all stored backups (newest first).
 */
export function getBackupHistory(): { timestamp: number; size: number }[] {
  return readBackups()
    .map(({ timestamp, size }) => ({ timestamp, size }))
    .sort((a, b) => b.timestamp - a.timestamp);
}

// ---------------------------------------------------------------------------
// Settings change watcher — triggers auto-backup on mutations
// ---------------------------------------------------------------------------

let backupTimer: ReturnType<typeof setTimeout> | null = null;
const BACKUP_DEBOUNCE_MS = 5000;

/**
 * Call this after any programmatic settings change to schedule an auto-backup.
 * The backup is debounced so rapid successive changes only trigger one backup.
 */
export function scheduleAutoBackup(): void {
  if (backupTimer !== null) {
    clearTimeout(backupTimer);
  }
  backupTimer = setTimeout(() => {
    autoBackup();
    backupTimer = null;
  }, BACKUP_DEBOUNCE_MS);
}

// ---------------------------------------------------------------------------
// Convenience: update a single setting and trigger backup
// ---------------------------------------------------------------------------

/**
 * Set a single key within a category and schedule an auto-backup.
 */
export function setSetting(category: SyncCategory, key: string, value: unknown): void {
  const catData = readCategorySettings(category);
  catData[key] = value;
  writeCategorySettings(category, catData);
  scheduleAutoBackup();
}

/**
 * Read a single key from a category.
 */
export function getSetting<T = unknown>(category: SyncCategory, key: string): T | undefined {
  const catData = readCategorySettings(category);
  return catData[key] as T | undefined;
}

/**
 * Remove a single key from a category.
 */
export function removeSetting(category: SyncCategory, key: string): void {
  const catData = readCategorySettings(category);
  delete catData[key];
  writeCategorySettings(category, catData);
  scheduleAutoBackup();
}

// ---------------------------------------------------------------------------
// Bundle serialisation helpers (for file save/load in the future)
// ---------------------------------------------------------------------------

/**
 * Serialise a bundle to a JSON string suitable for saving to a file.
 */
export function bundleToJson(bundle: SyncBundle): string {
  return JSON.stringify(bundle, null, 2);
}

/**
 * Parse a JSON string back into a {@link SyncBundle}, with basic validation.
 */
export function jsonToBundle(json: string): SyncBundle | null {
  try {
    const obj = JSON.parse(json);
    if (typeof obj !== 'object' || obj === null) return null;
    if (typeof obj.version !== 'number') return null;
    if (!Array.isArray(obj.categories)) return null;
    if (typeof obj.data !== 'object' || obj.data === null) return null;
    return obj as SyncBundle;
  } catch {
    return null;
  }
}
