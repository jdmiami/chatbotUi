import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyImport,
  buildExport,
  collectOrbitData,
  dataSize,
  describeKey,
  describeKeys,
  exportFileName,
  isOrbitKey,
  MAX_IMPORT_BYTES,
  parseImport,
} from '../../src/apps/settings/dataTransfer';

/** In-memory Storage; `failOn` makes setItem throw for that key (simulates a full quota). */
class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  failOn: string | null = null;
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(key: string) {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  setItem(key: string, value: string) {
    if (key === this.failOn) throw new DOMException('Quota exceeded', 'QuotaExceededError');
    this.map.set(key, String(value));
  }
  [name: string]: unknown;
}

const valid = (data: Record<string, unknown> = { 'orbit:shell:v1': '{"state":{}}' }) =>
  JSON.stringify({ app: 'orbit', version: 1, exportedAt: '2026-10-14T10:00:00.000Z', data });

let storage: MemoryStorage;
beforeEach(() => {
  storage = new MemoryStorage();
  storage.setItem('orbit:shell:v1', '{"state":{"settings":{"theme":"light"}},"version":0}');
  storage.setItem('orbit:files:v1', '{"version":1,"files":{}}');
  storage.setItem('other-app', 'keep me');
  storage.setItem('orbit', 'not ours either');
});

describe('isOrbitKey', () => {
  it('accepts only keys with the orbit: prefix and a name after it', () => {
    expect(isOrbitKey('orbit:shell:v1')).toBe(true);
    expect(isOrbitKey('orbit:')).toBe(false);
    expect(isOrbitKey('orbit')).toBe(false);
    expect(isOrbitKey('Orbit:shell')).toBe(false);
    expect(isOrbitKey('xorbit:shell')).toBe(false);
  });
});

describe('export', () => {
  it('collects only orbit: keys, sorted', () => {
    expect(Object.keys(collectOrbitData(storage))).toEqual(['orbit:files:v1', 'orbit:shell:v1']);
  });

  it('builds the documented shape', () => {
    const now = new Date('2026-10-14T10:00:00.000Z');
    const out = buildExport(storage, now);
    expect(out).toEqual({
      app: 'orbit',
      version: 1,
      exportedAt: '2026-10-14T10:00:00.000Z',
      data: {
        'orbit:files:v1': '{"version":1,"files":{}}',
        'orbit:shell:v1': '{"state":{"settings":{"theme":"light"}},"version":0}',
      },
    });
  });

  it('names the file after the local date', () => {
    expect(exportFileName(new Date(2026, 0, 5, 12))).toBe('orbit-backup-2026-01-05.json');
  });

  it('round-trips through parseImport', () => {
    const text = JSON.stringify(buildExport(storage));
    const res = parseImport(text);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.backup.data).toEqual(collectOrbitData(storage));
  });

  it('measures size in UTF-16 bytes', () => {
    expect(dataSize({ 'orbit:a': 'bc' })).toBe((7 + 2) * 2);
  });
});

describe('parseImport rejects bad files with a readable reason', () => {
  const cases: [string, string, RegExp][] = [
    ['not JSON', '{nope', /valid JSON/],
    ['an array', '[]', /isn’t an Orbit backup/],
    ['another app', JSON.stringify({ app: 'other', version: 1, exportedAt: '2026-01-01', data: {} }), /isn’t an Orbit backup/],
    ['a future version', JSON.stringify({ app: 'orbit', version: 2, exportedAt: '2026-01-01', data: {} }), /version 2/],
    ['a missing date', JSON.stringify({ app: 'orbit', version: 1, data: { 'orbit:a': 'x' } }), /export date/],
    ['a bad date', JSON.stringify({ app: 'orbit', version: 1, exportedAt: 'yesterday', data: { 'orbit:a': 'x' } }), /export date/],
    ['data as an array', JSON.stringify({ app: 'orbit', version: 1, exportedAt: '2026-01-01', data: [] }), /no data/],
    ['empty data', valid({}), /empty/],
    ['a foreign key', valid({ 'orbit:shell:v1': '{}', token: 'x' }), /“token”.*isn’t Orbit data/],
    ['a bare prefix key', valid({ 'orbit:': 'x' }), /isn’t Orbit data/],
    ['a non-string value', valid({ 'orbit:shell:v1': { state: {} } }), /damaged/],
  ];
  it.each(cases)('%s', (_name, text, message) => {
    const res = parseImport(text);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(message);
  });

  it('rejects files larger than browser storage could hold', () => {
    const res = parseImport(' '.repeat(MAX_IMPORT_BYTES / 2 + 1));
    expect(res).toEqual({ ok: false, error: expect.stringMatching(/too large/) });
  });

  it('ignores extra top-level fields and returns only the validated data', () => {
    const text = JSON.stringify({
      app: 'orbit',
      version: 1,
      exportedAt: '2026-10-14T10:00:00.000Z',
      data: { 'orbit:shell:v1': '{}' },
      extra: true,
    });
    const res = parseImport(text);
    expect(res).toEqual({
      ok: true,
      backup: { app: 'orbit', version: 1, exportedAt: '2026-10-14T10:00:00.000Z', data: { 'orbit:shell:v1': '{}' } },
    });
  });
});

describe('applyImport', () => {
  it('replaces all orbit: keys and leaves other keys alone', () => {
    const n = applyImport(storage, { 'orbit:shell:v1': 'new', 'orbit:runner:v1': 'r' });
    expect(n).toBe(2);
    expect(collectOrbitData(storage)).toEqual({ 'orbit:runner:v1': 'r', 'orbit:shell:v1': 'new' });
    expect(storage.getItem('orbit:files:v1')).toBeNull();
    expect(storage.getItem('other-app')).toBe('keep me');
    expect(storage.getItem('orbit')).toBe('not ours either');
  });

  it('refuses non-Orbit keys without touching storage', () => {
    const before = collectOrbitData(storage);
    expect(() => applyImport(storage, { evil: 'x' })).toThrow(/non-Orbit/);
    expect(collectOrbitData(storage)).toEqual(before);
  });

  it('puts the previous data back when a write fails', () => {
    const before = collectOrbitData(storage);
    storage.failOn = 'orbit:runner:v1';
    expect(() => applyImport(storage, { 'orbit:a:v1': 'a', 'orbit:runner:v1': 'big' })).toThrow(/Quota/);
    storage.failOn = null;
    expect(collectOrbitData(storage)).toEqual(before);
  });
});

describe('describeKey', () => {
  it('gives friendly names for known keys and falls back to the key', () => {
    expect(describeKey('orbit:shell:v1')).toBe('Preferences');
    expect(describeKey('orbit:editor:v1:host')).toBe('Open tabs in Code');
    expect(describeKey('orbit:custom')).toBe('orbit:custom');
    expect(describeKeys(['orbit:editor:v1:demo', 'orbit:editor:v1:host', 'orbit:files:v1'])).toEqual([
      'Open tabs in Code',
      'Demo project files',
    ]);
  });
});
