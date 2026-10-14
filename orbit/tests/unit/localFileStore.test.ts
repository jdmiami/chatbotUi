import { describe, expect, it, vi } from 'vitest';
import { LocalFileStore, LOCAL_FILES_KEY } from '../../src/services/files/local/LocalFileStore';
import { DEMO_PROJECT_FILES } from '../../src/services/files/local/seed';
import { FileStoreError, normalizePath } from '../../src/services/files/types';

/** In-memory Storage so tests never touch jsdom's shared localStorage. */
class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  clear() {
    this.data.clear();
  }
  getItem(key: string) {
    return this.data.has(key) ? this.data.get(key)! : null;
  }
  key(i: number) {
    return [...this.data.keys()][i] ?? null;
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  setItem(key: string, value: string) {
    this.data.set(key, String(value));
  }
}

const seedPaths = DEMO_PROJECT_FILES.map((f) => f.path).sort((a, b) => a.localeCompare(b));

async function expectCode(p: Promise<unknown>, code: FileStoreError['code']) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(FileStoreError);
  expect((err as FileStoreError).code).toBe(code);
}

describe('normalizePath', () => {
  it('cleans relative paths', () => {
    expect(normalizePath('src/app.py')).toBe('src/app.py');
    expect(normalizePath('  ./src//app.py  ')).toBe('src/app.py');
    expect(normalizePath('src\\win\\file.txt')).toBe('src/win/file.txt');
    expect(normalizePath('notes/')).toBe('notes');
  });

  it('rejects absolute paths', () => {
    expect(() => normalizePath('/etc/passwd')).toThrow(FileStoreError);
    expect(() => normalizePath('\\etc\\passwd')).toThrow(/absolute/);
  });

  it('rejects ".." anywhere in the path', () => {
    expect(() => normalizePath('../secret')).toThrow(/\.\./);
    expect(() => normalizePath('src/../../x')).toThrow(FileStoreError);
    expect(() => normalizePath('a/..')).toThrow(FileStoreError);
  });

  it('rejects empty names, control characters and over-long segments', () => {
    for (const bad of ['', '   ', '.', './', '//']) {
      let err: unknown = null;
      try {
        normalizePath(bad);
      } catch (e) {
        err = e;
      }
      expect(err, JSON.stringify(bad)).toBeInstanceOf(FileStoreError);
      expect((err as FileStoreError).code).toBe('invalid-path');
    }
    expect(() => normalizePath('a\u0000b')).toThrow(/control/);
    expect(() => normalizePath('bad\nname')).toThrow(/control/);
    expect(() => normalizePath('x'.repeat(256))).toThrow(/too long/);
    expect(normalizePath('x'.repeat(255))).toHaveLength(255);
  });
});

describe('LocalFileStore', () => {
  it('describes itself as browser-local and seeds the demo project on first use', async () => {
    const storage = new MemoryStorage();
    const store = new LocalFileStore(storage);
    expect(store.kind).toBe('browser-local');
    expect(store.label).toMatch(/this browser only/i);
    expect(store.rootName).toBe('orbit-demo');
    const list = await store.list();
    expect(list.map((e) => e.path)).toEqual(seedPaths);
    expect(storage.getItem(LOCAL_FILES_KEY)).not.toBeNull();
    const readme = list.find((e) => e.path === 'README.md')!;
    expect(readme.size).toBe(new Blob([DEMO_PROJECT_FILES[0].content]).size);
    expect(readme.updatedAt).toBeGreaterThan(0);
  });

  it('creates, reads, overwrites and removes files', async () => {
    const store = new LocalFileStore(new MemoryStorage());
    await store.write('src/new.ts', 'export const a = 1;\n');
    expect(await store.read('src/new.ts')).toBe('export const a = 1;\n');
    expect(await store.read('./src//new.ts')).toBe('export const a = 1;\n');

    await store.write('src/new.ts', 'changed');
    expect(await store.read('src/new.ts')).toBe('changed');
    expect((await store.list()).find((e) => e.path === 'src/new.ts')?.size).toBe(7);

    await store.write('empty.txt', '');
    expect(await store.read('empty.txt')).toBe('');

    await store.remove('src/new.ts');
    await expectCode(store.read('src/new.ts'), 'not-found');
    await expectCode(store.remove('src/new.ts'), 'not-found');
    expect((await store.list()).some((e) => e.path === 'src/new.ts')).toBe(false);
  });

  it('measures size in bytes (UTF-8), not characters', async () => {
    const store = new LocalFileStore(new MemoryStorage());
    await store.write('emoji.txt', 'é🚀');
    expect((await store.list()).find((e) => e.path === 'emoji.txt')?.size).toBe(6);
  });

  it('validates paths on every operation', async () => {
    const store = new LocalFileStore(new MemoryStorage());
    await expectCode(store.write('/abs.txt', 'x'), 'invalid-path');
    await expectCode(store.write('../escape.txt', 'x'), 'invalid-path');
    await expectCode(store.read('src/../../etc/passwd'), 'invalid-path');
    await expectCode(store.rename('README.md', '../README.md'), 'invalid-path');
    await expectCode(store.remove('/README.md'), 'invalid-path');
  });

  it('refuses to write a file over an implicit folder', async () => {
    const store = new LocalFileStore(new MemoryStorage());
    await expectCode(store.write('src', 'x'), 'exists');
  });

  it('renames files and refuses to overwrite an existing one', async () => {
    const store = new LocalFileStore(new MemoryStorage());
    const before = await store.read('notes/todo.md');
    await store.rename('notes/todo.md', 'notes/done.md');
    expect(await store.read('notes/done.md')).toBe(before);
    await expectCode(store.read('notes/todo.md'), 'not-found');

    await expectCode(store.rename('notes/done.md', 'README.md'), 'exists');
    expect(await store.read('notes/done.md')).toBe(before); // untouched after the failed rename
    await expectCode(store.rename('missing.md', 'other.md'), 'not-found');

    // Renaming to itself is a no-op.
    await store.rename('README.md', './README.md');
    expect((await store.list()).filter((e) => e.path === 'README.md')).toHaveLength(1);
  });

  it('persists across instances sharing the same storage', async () => {
    const storage = new MemoryStorage();
    const a = new LocalFileStore(storage);
    await a.write('README.md', '# changed\n');
    await a.write('src/extra.py', 'print(1)\n');
    await a.remove('notes/todo.md');

    const b = new LocalFileStore(storage);
    expect(await b.read('README.md')).toBe('# changed\n');
    expect(await b.read('src/extra.py')).toBe('print(1)\n');
    await expectCode(b.read('notes/todo.md'), 'not-found');

    // A different storage key is a different project.
    const c = new LocalFileStore(storage, 'orbit:files:other');
    expect(await c.read('README.md')).toBe(DEMO_PROJECT_FILES[0].content);
  });

  it('notifies subscribers after each change and stops after unsubscribe', async () => {
    const store = new LocalFileStore(new MemoryStorage());
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    await store.write('a.txt', '1');
    expect(listener).toHaveBeenCalledTimes(1);
    await store.rename('a.txt', 'b.txt');
    expect(listener).toHaveBeenCalledTimes(2);
    await store.remove('b.txt');
    expect(listener).toHaveBeenCalledTimes(3);

    // Failed operations don't notify.
    await expectCode(store.remove('b.txt'), 'not-found');
    expect(listener).toHaveBeenCalledTimes(3);

    unsubscribe();
    await store.write('c.txt', '3');
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('reloads and notifies when another browser tab changes the same key', async () => {
    const storage = new MemoryStorage();
    const store = new LocalFileStore(storage);
    await store.list();
    const listener = vi.fn();
    store.subscribe(listener);

    const other = new LocalFileStore(storage);
    await other.write('README.md', 'from another tab');
    window.dispatchEvent(new StorageEvent('storage', { key: LOCAL_FILES_KEY }));

    expect(listener).toHaveBeenCalledTimes(1);
    expect(await store.read('README.md')).toBe('from another tab');

    window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated' }));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('reset() restores the seeded demo project', async () => {
    const storage = new MemoryStorage();
    const store = new LocalFileStore(storage);
    const listener = vi.fn();
    store.subscribe(listener);
    await store.write('README.md', 'edited');
    await store.write('scratch.txt', 'tmp');
    await store.remove('src/app.py');

    store.reset();
    expect(listener).toHaveBeenCalledTimes(4);
    expect((await store.list()).map((e) => e.path)).toEqual(seedPaths);
    expect(await store.read('README.md')).toBe(DEMO_PROJECT_FILES[0].content);
    // And the reset is persisted for the next instance too.
    expect(await new LocalFileStore(storage).read('README.md')).toBe(DEMO_PROJECT_FILES[0].content);
  });

  it('falls back to the seed when stored data is corrupted', async () => {
    const storage = new MemoryStorage();
    storage.setItem(LOCAL_FILES_KEY, '{not json');
    const store = new LocalFileStore(storage);
    expect((await store.list()).map((e) => e.path)).toEqual(seedPaths);
  });

  it('reports a full browser storage as a quota error', async () => {
    const storage = new MemoryStorage();
    const store = new LocalFileStore(storage);
    await store.list();
    storage.setItem = () => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    };
    const err = await store.write('big.txt', 'x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FileStoreError);
    expect((err as FileStoreError).code).toBe('quota');
    expect((err as FileStoreError).message).toMatch(/storage is full/i);
    // The failed write left the store unchanged.
    await expectCode(store.read('big.txt'), 'not-found');
  });

  it('reports other storage failures as io errors', async () => {
    const storage = new MemoryStorage();
    const store = new LocalFileStore(storage);
    await store.list();
    storage.setItem = () => {
      throw new Error('SecurityError');
    };
    await expectCode(store.write('x.txt', 'x'), 'io');
  });
});
