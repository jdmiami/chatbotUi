/**
 * Settings → Data & storage: export / import of Orbit's browser-local data.
 *
 * Everything Orbit keeps in this browser lives in localStorage under keys that start with
 * "orbit:" (preferences, recents, Code tabs, and — in demo mode — the demo project and demo
 * Antigravity sessions). Files and sessions on the Linux machine are never part of this.
 *
 * Pure helpers (no React, no DOM besides the Storage interface) so they are unit-tested directly
 * (tests/unit/settings-export.test.ts).
 */

export const KEY_PREFIX = 'orbit:';
export const EXPORT_APP = 'orbit';
export const EXPORT_VERSION = 1;
/** localStorage holds ~5 MB per origin in Safari; anything bigger can't be a real Orbit backup. */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

export interface OrbitExport {
  app: typeof EXPORT_APP;
  version: typeof EXPORT_VERSION;
  /** ISO 8601 timestamp. */
  exportedAt: string;
  /** Raw localStorage values, keyed by their "orbit:…" key. */
  data: Record<string, string>;
}

export type ParseResult = { ok: true; backup: OrbitExport } | { ok: false; error: string };

export function isOrbitKey(key: string): boolean {
  return key.startsWith(KEY_PREFIX) && key.length > KEY_PREFIX.length;
}

/** Every "orbit:" key in storage with its raw value. Unreadable storage yields what could be read. */
export function collectOrbitData(storage: Storage): Record<string, string> {
  const data: Record<string, string> = {};
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key && isOrbitKey(key)) keys.push(key);
  }
  for (const key of keys.sort()) {
    const value = storage.getItem(key);
    if (value !== null) data[key] = value;
  }
  return data;
}

export function buildExport(storage: Storage, now: Date = new Date()): OrbitExport {
  return { app: EXPORT_APP, version: EXPORT_VERSION, exportedAt: now.toISOString(), data: collectOrbitData(storage) };
}

/** e.g. "orbit-backup-2026-10-14.json" (local date). */
export function exportFileName(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `orbit-backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
}

/** Total size of the stored strings, in bytes (UTF-16, which is how browsers count the quota). */
export function dataSize(data: Record<string, string>): number {
  let chars = 0;
  for (const [k, v] of Object.entries(data)) chars += k.length + v.length;
  return chars * 2;
}

/** A friendly name for a storage key, for the import confirmation. */
export function describeKey(key: string): string {
  if (key === 'orbit:shell:v1') return 'Preferences';
  if (key === 'orbit:workspace:v1') return 'Recent files and sessions';
  if (key === 'orbit:files:v1') return 'Demo project files';
  if (key === 'orbit:runner:v1') return 'Demo Antigravity sessions';
  if (key.startsWith('orbit:editor:')) return 'Open tabs in Code';
  return key;
}

/** Unique friendly names, in a stable order. */
export function describeKeys(keys: string[]): string[] {
  return [...new Set(keys.map(describeKey))];
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
}

/** Validate a backup file's text. Error messages are written for the person picking the file. */
export function parseImport(text: string): ParseResult {
  if (text.length * 2 > MAX_IMPORT_BYTES) {
    return { ok: false, error: 'This file is too large to be an Orbit backup.' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'This file isn’t valid JSON. Choose a backup exported from Orbit Settings.' };
  }
  if (!isPlainObject(parsed) || parsed.app !== EXPORT_APP) {
    return { ok: false, error: 'This isn’t an Orbit backup. Choose a file exported from Orbit Settings.' };
  }
  if (parsed.version !== EXPORT_VERSION) {
    return {
      ok: false,
      error: `This backup uses format version ${String(parsed.version)}, which this version of Orbit can’t read.`,
    };
  }
  if (typeof parsed.exportedAt !== 'string' || Number.isNaN(Date.parse(parsed.exportedAt))) {
    return { ok: false, error: 'This backup is missing its export date, so it may be damaged.' };
  }
  if (!isPlainObject(parsed.data)) {
    return { ok: false, error: 'This backup has no data section, so it may be damaged.' };
  }
  const entries = Object.entries(parsed.data);
  if (entries.length === 0) {
    return { ok: false, error: 'This backup is empty. There is nothing to import.' };
  }
  const data: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (!isOrbitKey(key)) {
      return { ok: false, error: `This backup contains “${key}”, which isn’t Orbit data. Nothing was imported.` };
    }
    if (typeof value !== 'string') {
      return { ok: false, error: `The entry “${key}” in this backup is damaged. Nothing was imported.` };
    }
    data[key] = value;
  }
  return { ok: true, backup: { app: EXPORT_APP, version: EXPORT_VERSION, exportedAt: parsed.exportedAt, data } };
}

/**
 * Replace every "orbit:" key in storage with the backup's data. Keys that aren't Orbit's are left
 * alone. If a write fails (e.g. storage full), the previous Orbit data is put back and the error
 * is rethrown, so a failed import never leaves a half-written mix.
 */
export function applyImport(storage: Storage, data: Record<string, string>): number {
  for (const key of Object.keys(data)) {
    if (!isOrbitKey(key)) throw new Error(`Refusing to write non-Orbit key "${key}".`);
  }
  const previous = collectOrbitData(storage);
  try {
    for (const key of Object.keys(previous)) storage.removeItem(key);
    for (const [key, value] of Object.entries(data)) storage.setItem(key, value);
  } catch (err) {
    try {
      for (const key of Object.keys(collectOrbitData(storage))) storage.removeItem(key);
      for (const [key, value] of Object.entries(previous)) storage.setItem(key, value);
    } catch {
      /* best effort: the original error is what matters */
    }
    throw err;
  }
  return Object.keys(data).length;
}
