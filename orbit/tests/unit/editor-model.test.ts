import { describe, expect, it } from 'vitest';
import {
  buildTree,
  EDITOR_STATE_KEY,
  editorSummary,
  loadEditorState,
  minimalChange,
  saveEditorState,
  validateNewPath,
  visibleRows,
  type TreeFolder,
} from '../../src/apps/editor/model';
import type { FileEntry } from '../../src/services/files/types';

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
    expect(JSON.parse(s.getItem(EDITOR_STATE_KEY)!)).toEqual({
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
    s.setItem(EDITOR_STATE_KEY, '{broken');
    expect(loadEditorState(s)).toBeNull();
    s.setItem(EDITOR_STATE_KEY, JSON.stringify({ open: 'nope' }));
    expect(loadEditorState(s)).toBeNull();
    s.setItem(EDITOR_STATE_KEY, JSON.stringify({ open: ['a', 'a', 3, '', 'b'], active: 'zzz', sidebar: 'x' }));
    expect(loadEditorState(s)).toEqual({ open: ['a', 'b'], active: 'a', sidebar: undefined, wrap: undefined });
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
