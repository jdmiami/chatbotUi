import { describe, expect, it } from 'vitest';
import {
  ancestorFolders,
  buildTree,
  deleteWarning,
  EDITOR_STATE_KEY,
  editorStateKey,
  editorSummary,
  errorMessage,
  filterEntries,
  foldersOpenByDefault,
  isFolderCollapsed,
  isRetryable,
  LARGE_TREE_FILES,
  loadEditorState,
  minimalChange,
  savedMessage,
  saveEditorState,
  storageNote,
  validateNewPath,
  visibleRows,
  whereSuffix,
  type TreeFolder,
} from '../../src/apps/editor/model';
import { FileStoreError, type FileEntry } from '../../src/services/files/types';

const entry = (path: string): FileEntry => ({ path, size: 1, updatedAt: 0 });

class MemoryStorage implements Storage {
  data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  clear() {
    this.data.clear();
  }
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  key(i: number) {
    return [...this.data.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
}

describe('buildTree', () => {
  const tree = buildTree(
    ['src/utils.ts', 'README.md', 'src/app.py', 'config/settings.json', 'src/lib/deep/x.ts', 'a.txt'].map(entry),
  );

  it('derives implicit folders, folders first then files, alphabetical', () => {
    expect(tree.map((n) => `${n.kind}:${n.name}`)).toEqual(['folder:config', 'folder:src', 'file:a.txt', 'file:README.md']);
    const src = tree[1] as TreeFolder;
    expect(src.path).toBe('src');
    expect(src.children.map((n) => n.name)).toEqual(['lib', 'app.py', 'utils.ts']);
    const deep = ((src.children[0] as TreeFolder).children[0] as TreeFolder).children[0];
    expect(deep).toMatchObject({ kind: 'file', name: 'x.ts', path: 'src/lib/deep/x.ts' });
  });

  it('visibleRows flattens with depth and hides collapsed folders', () => {
    const all = visibleRows(tree, new Set());
    expect(all.map((r) => `${r.depth}:${r.node.name}`)).toEqual([
      '0:config',
      '1:settings.json',
      '0:src',
      '1:lib',
      '2:deep',
      '3:x.ts',
      '1:app.py',
      '1:utils.ts',
      '0:a.txt',
      '0:README.md',
    ]);
    const collapsed = visibleRows(tree, new Set(['src/lib', 'config']));
    expect(collapsed.map((r) => r.node.name)).toEqual(['config', 'src', 'lib', 'app.py', 'utils.ts', 'a.txt', 'README.md']);
  });

  it('handles an empty project', () => {
    expect(buildTree([])).toEqual([]);
  });
});

describe('persisted editor state', () => {
  it('returns null on first launch', () => {
    expect(loadEditorState(new MemoryStorage())).toBeNull();
    expect(loadEditorState(null)).toBeNull();
  });

  it('round-trips open tabs and the active file', () => {
    const s = new MemoryStorage();
    saveEditorState({ open: ['README.md', 'src/app.py'], active: 'src/app.py', sidebar: false, wrap: true }, s);
    expect(JSON.parse(s.getItem(editorStateKey('demo'))!)).toEqual({
      open: ['README.md', 'src/app.py'],
      active: 'src/app.py',
      sidebar: false,
      wrap: true,
    });
    expect(loadEditorState(s)).toEqual({ open: ['README.md', 'src/app.py'], active: 'src/app.py', sidebar: false, wrap: true });
  });

  it('keeps an empty tab list (user closed everything) distinct from first launch', () => {
    const s = new MemoryStorage();
    saveEditorState({ open: [], active: null }, s);
    expect(loadEditorState(s)).toMatchObject({ open: [], active: null });
  });

  it('sanitises bad data', () => {
    const s = new MemoryStorage();
    s.setItem(editorStateKey('demo'), '{broken');
    expect(loadEditorState(s)).toBeNull();
    s.setItem(editorStateKey('demo'), JSON.stringify({ open: 'nope' }));
    expect(loadEditorState(s)).toBeNull();
    s.setItem(editorStateKey('demo'), JSON.stringify({ open: ['a', 'a', 3, '', 'b'], active: 'zzz', sidebar: 'x' }));
    expect(loadEditorState(s)).toEqual({ open: ['a', 'b'], active: 'a', sidebar: undefined, wrap: undefined });
  });

  it('keeps host and demo tab lists apart', () => {
    const s = new MemoryStorage();
    expect(editorStateKey('host')).toBe('orbit:editor:v1:host');
    expect(editorStateKey('demo')).toBe('orbit:editor:v1:demo');
    saveEditorState({ open: ['README.md'], active: 'README.md' }, s, 'demo');
    expect(loadEditorState(s, 'host')).toBeNull(); // demo paths never leak into the real machine
    saveEditorState({ open: ['server/main.go'], active: 'server/main.go' }, s, 'host');
    expect(loadEditorState(s, 'host')).toMatchObject({ open: ['server/main.go'] });
    expect(loadEditorState(s, 'demo')).toMatchObject({ open: ['README.md'] });
  });

  it('migrates the legacy key for demo mode only', () => {
    const s = new MemoryStorage();
    s.setItem(EDITOR_STATE_KEY, JSON.stringify({ open: ['src/app.py'], active: 'src/app.py' }));
    expect(loadEditorState(s, 'demo')).toMatchObject({ open: ['src/app.py'], active: 'src/app.py' });
    expect(loadEditorState(s, 'host')).toBeNull();
    // Once the per-mode key exists it wins.
    saveEditorState({ open: [], active: null }, s, 'demo');
    expect(loadEditorState(s, 'demo')).toMatchObject({ open: [] });
  });

  it('never throws when storage is unavailable', () => {
    const broken = new MemoryStorage();
    broken.getItem = () => {
      throw new Error('blocked');
    };
    broken.setItem = () => {
      throw new Error('blocked');
    };
    expect(loadEditorState(broken)).toBeNull();
    expect(() => saveEditorState({ open: [], active: null }, broken)).not.toThrow();
  });
});

describe('minimalChange', () => {
  const apply = (a: string, c: ReturnType<typeof minimalChange>) => (c ? a.slice(0, c.from) + c.insert + a.slice(c.to) : a);

  it.each([
    ['hello world', 'hello brave world'],
    ['abc', ''],
    ['', 'abc'],
    ['line1\nline2\nline3\n', 'line1\nLINE2\nline3\n'],
    ['aaaa', 'aa'],
    ['abcabc', 'abc'],
    ['x', 'y'],
  ])('%j → %j', (a, b) => {
    const change = minimalChange(a, b);
    expect(apply(a, change)).toBe(b);
  });

  it('returns null when equal and keeps the common prefix/suffix', () => {
    expect(minimalChange('same', 'same')).toBeNull();
    expect(minimalChange('function a() {}', 'function ab() {}')).toEqual({ from: 10, to: 10, insert: 'b' });
  });
});

describe('validateNewPath', () => {
  const existing = ['README.md', 'src/app.py', 'src/utils.ts'];

  it('accepts new files, including new folders', () => {
    expect(validateNewPath('notes.txt', existing)).toBeNull();
    expect(validateNewPath('docs/new/guide.md', existing)).toBeNull();
    expect(validateNewPath('./src/new.ts', existing)).toBeNull();
  });

  it('rejects invalid paths with the store message', () => {
    expect(validateNewPath('', existing)).toMatch(/empty/i);
    expect(validateNewPath('/etc/hosts', existing)).toMatch(/absolute/i);
    expect(validateNewPath('../x', existing)).toMatch(/\.\./);
  });

  it('rejects existing files, folders, and files used as folders', () => {
    expect(validateNewPath('README.md', existing)).toMatch(/already exists/);
    expect(validateNewPath('src', existing)).toMatch(/is a folder/);
    expect(validateNewPath('README.md/child.txt', existing)).toMatch(/is a file/);
  });

  it('allows renaming a file to itself', () => {
    expect(validateNewPath('src/app.py', existing, 'src/app.py')).toBeNull();
    expect(validateNewPath('README.md', existing, 'src/app.py')).toMatch(/already exists/);
  });
});

describe('editorSummary', () => {
  it('mentions "unsaved" whenever a tab is dirty', () => {
    expect(editorSummary([{ path: 'src/app.py', dirty: true }], 'src/app.py')).toBe('app.py — unsaved changes');
    const two = editorSummary(
      [
        { path: 'README.md', dirty: true },
        { path: 'src/app.py', dirty: true },
        { path: 'x.ts', dirty: false },
      ],
      'src/app.py',
    );
    expect(two).toBe('app.py and 1 more — unsaved changes');
    expect(two).toContain('unsaved');
  });

  it('counts open files otherwise', () => {
    expect(editorSummary([], null)).toBe('No file open');
    expect(editorSummary([{ path: 'a', dirty: false }], 'a')).toBe('1 file open');
    expect(
      editorSummary(
        [
          { path: 'a', dirty: false },
          { path: 'b', dirty: false },
        ],
        'a',
      ),
    ).toBe('2 files open');
  });
});

describe('large trees', () => {
  const entries = ['a/b/c.ts', 'a/d.ts', 'e/f.ts', 'g.ts'].map(entry);
  const tree = buildTree(entries);

  it('collapses folders by default only for big projects', () => {
    expect(foldersOpenByDefault(3)).toBe(true);
    expect(foldersOpenByDefault(LARGE_TREE_FILES)).toBe(true);
    expect(foldersOpenByDefault(LARGE_TREE_FILES + 1)).toBe(false);
  });

  it('isFolderCollapsed applies explicit choices over the default', () => {
    const overrides = new Map([
      ['a', true],
      ['e', false],
    ]);
    expect(isFolderCollapsed('a', overrides, false)).toBe(false);
    expect(isFolderCollapsed('e', overrides, true)).toBe(true);
    expect(isFolderCollapsed('x', overrides, true)).toBe(false);
    expect(isFolderCollapsed('x', overrides, false)).toBe(true);
  });

  it('visibleRows accepts a predicate (all collapsed shows only the top level)', () => {
    expect(visibleRows(tree, () => true).map((r) => r.node.name)).toEqual(['a', 'e', 'g.ts']);
    const onlyA = visibleRows(tree, (p) => p !== 'a');
    expect(onlyA.map((r) => `${r.depth}:${r.node.name}`)).toEqual(['0:a', '1:b', '1:d.ts', '0:e', '0:g.ts']);
  });

  it('stays fast for thousands of files', () => {
    const many = Array.from({ length: 5000 }, (_, i) => entry(`pkg${i % 50}/mod${i % 7}/file${i}.ts`));
    const t0 = performance.now();
    const big = buildTree(many);
    const rows = visibleRows(big, (p) => isFolderCollapsed(p, new Map(), foldersOpenByDefault(many.length)));
    expect(rows).toHaveLength(50); // only the top-level folders
    expect(performance.now() - t0).toBeLessThan(1000);
  });

  it('ancestorFolders lists the containing folders outermost first', () => {
    expect(ancestorFolders('a/b/c.ts')).toEqual(['a', 'a/b']);
    expect(ancestorFolders('README.md')).toEqual([]);
  });
});

describe('filterEntries', () => {
  const entries = [
    'README.md',
    'src/app.py',
    'src/utils.ts',
    'src/components/AppHeader.tsx',
    'docs/app-notes.md',
    'tests/test_app.py',
    'config/settings.json',
  ].map(entry);

  it('returns nothing for an empty query', () => {
    expect(filterEntries(entries, '   ')).toEqual({ matches: [], total: 0 });
  });

  it('matches case-insensitively and ranks file-name matches first', () => {
    const { matches, total } = filterEntries(entries, 'APP');
    expect(total).toBe(4);
    // name starts with "app" → name contains "app" → path only; shorter paths first.
    expect(matches.map((m) => m.path)).toEqual([
      'src/app.py',
      'docs/app-notes.md',
      'src/components/AppHeader.tsx',
      'tests/test_app.py',
    ]);
  });

  it('requires every term', () => {
    expect(filterEntries(entries, 'src ts').matches.map((m) => m.path)).toEqual([
      'src/utils.ts',
      'src/components/AppHeader.tsx',
    ]);
    expect(filterEntries(entries, 'nope').total).toBe(0);
  });

  it('caps the results but reports the full count', () => {
    const many = Array.from({ length: 1000 }, (_, i) => entry(`f/file${i}.txt`));
    const r = filterEntries(many, 'file', 200);
    expect(r.matches).toHaveLength(200);
    expect(r.total).toBe(1000);
    expect(r.matches[0].path).toBe('f/file0.txt'); // numeric-aware ordering
  });
});

describe('storage wording', () => {
  it('uses the store label for the note (never a hard-coded browser message)', () => {
    expect(storageNote({ kind: 'server', label: 'Saved on your Linux machine' })).toBe('Saved on your Linux machine');
    expect(storageNote({ kind: 'browser-local', label: 'Saved in this browser only — not synced' })).toMatch(/browser/);
  });

  it('says where a save went', () => {
    expect(whereSuffix('server')).toBe(' on your Linux machine');
    expect(whereSuffix('browser-local')).toBe(' in this browser');
    expect(savedMessage('app.py', 'server')).toBe('Saved app.py on your Linux machine');
    expect(savedMessage('app.py', 'browser-local')).toBe('Saved app.py in this browser');
  });

  it('delete warning names the right place', () => {
    expect(deleteWarning('server')).toMatch(/Linux machine/);
    expect(deleteWarning('server')).not.toMatch(/browser/);
    expect(deleteWarning('browser-local')).toMatch(/browser/);
  });
});

describe('errors', () => {
  it('turns anything into a readable message', () => {
    expect(errorMessage(new FileStoreError('Could not reach the Linux machine.', 'io'))).toBe(
      'Could not reach the Linux machine.',
    );
    expect(errorMessage(new Error('boom'))).toBe('boom');
    expect(errorMessage('weird')).toMatch(/went wrong/);
  });

  it('only offers Retry when trying again could help', () => {
    expect(isRetryable(new FileStoreError('down', 'io'))).toBe(true);
    expect(isRetryable(new Error('network'))).toBe(true);
    expect(isRetryable(new FileStoreError('gone', 'not-found'))).toBe(false);
    expect(isRetryable(new FileStoreError('bad', 'invalid-path'))).toBe(false);
  });
});

describe('storageNote with a cut-off listing', () => {
  it('says when the machine listed only the first 5,000 files', () => {
    expect(storageNote({ kind: 'server', label: 'Saved on your Linux machine', truncated: true })).toBe(
      'Saved on your Linux machine. Showing the first 5,000 files; use Terminal for the rest.',
    );
    expect(storageNote({ kind: 'server', label: 'Saved on your Linux machine', truncated: false })).toBe(
      'Saved on your Linux machine',
    );
  });
});
