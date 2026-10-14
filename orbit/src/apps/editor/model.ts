/**
 * Pure helpers for the Code app (no React, no CodeMirror) so they can be unit tested:
 * the project tree and file filter, persisted tab list, minimal document diffs, path validation,
 * storage wording and the App Switcher summary.
 */
import { FileStoreError, normalizePath, type FileEntry, type FileStore } from '../../services/files/types';

/* ------------------------------------------------------------------ Project tree */

export interface TreeFile {
  kind: 'file';
  name: string;
  path: string;
  entry: FileEntry;
}
export interface TreeFolder {
  kind: 'folder';
  name: string;
  path: string;
  children: TreeNode[];
}
export type TreeNode = TreeFile | TreeFolder;

/** Builds a tree from flat file paths. Folders are implicit (derived from paths), listed before files, A→Z. */
export function buildTree(entries: FileEntry[]): TreeNode[] {
  const root: TreeFolder = { kind: 'folder', name: '', path: '', children: [] };
  const folders = new Map<string, TreeFolder>([['', root]]);
  const folderFor = (path: string): TreeFolder => {
    const existing = folders.get(path);
    if (existing) return existing;
    const i = path.lastIndexOf('/');
    const parent = folderFor(i < 0 ? '' : path.slice(0, i));
    const folder: TreeFolder = { kind: 'folder', name: path.slice(i + 1), path, children: [] };
    parent.children.push(folder);
    folders.set(path, folder);
    return folder;
  };
  for (const entry of entries) {
    const i = entry.path.lastIndexOf('/');
    const parent = folderFor(i < 0 ? '' : entry.path.slice(0, i));
    parent.children.push({ kind: 'file', name: entry.path.slice(i + 1), path: entry.path, entry });
  }
  const sort = (nodes: TreeNode[]) => {
    nodes.sort((a, b) =>
      a.kind !== b.kind ? (a.kind === 'folder' ? -1 : 1) : a.name.localeCompare(b.name, undefined, { numeric: true }),
    );
    nodes.forEach((n) => n.kind === 'folder' && sort(n.children));
  };
  sort(root.children);
  return root.children;
}

export interface TreeRow {
  node: TreeNode;
  depth: number;
}

/**
 * The rows a tree view shows, skipping the contents of collapsed folders.
 * `collapsed` is either the set of collapsed folder paths or a predicate.
 */
export function visibleRows(
  nodes: TreeNode[],
  collapsed: ReadonlySet<string> | ((folderPath: string) => boolean),
  depth = 0,
): TreeRow[] {
  const isCollapsed = typeof collapsed === 'function' ? collapsed : (p: string) => collapsed.has(p);
  const rows: TreeRow[] = [];
  const walk = (list: TreeNode[], d: number) => {
    for (const node of list) {
      rows.push({ node, depth: d });
      if (node.kind === 'folder' && !isCollapsed(node.path)) walk(node.children, d + 1);
    }
  };
  walk(nodes, depth);
  return rows;
}

/** Projects with more files than this start with every folder collapsed so the tree stays quick. */
export const LARGE_TREE_FILES = 200;

/** Whether folders start expanded for a project of this size. */
export function foldersOpenByDefault(fileCount: number): boolean {
  return fileCount <= LARGE_TREE_FILES;
}

/**
 * Folder open/closed state: explicit user choices (`overrides`, path → open) on top of a default
 * that depends on the project size.
 */
export function isFolderCollapsed(path: string, overrides: ReadonlyMap<string, boolean>, defaultOpen: boolean): boolean {
  const open = overrides.get(path);
  return !(open ?? defaultOpen);
}

/** The folders containing a file, outermost first ("a/b/c.ts" → ["a", "a/b"]). */
export function ancestorFolders(path: string): string[] {
  const parts = path.split('/');
  const out: string[] = [];
  for (let i = 1; i < parts.length; i++) out.push(parts.slice(0, i).join('/'));
  return out;
}

/* ------------------------------------------------------------------ File filter */

export interface FilterResult {
  matches: FileEntry[];
  /** Number of matching files before `limit` was applied. */
  total: number;
}

/**
 * Case-insensitive file filter for the file browser. Every whitespace-separated term must appear in
 * the path. Files whose name matches rank first (name prefix > name contains > path only), then
 * shorter paths, then A→Z. Returns at most `limit` matches so huge projects stay responsive.
 */
export function filterEntries(entries: readonly FileEntry[], query: string, limit = 200): FilterResult {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return { matches: [], total: 0 };
  const scored: { entry: FileEntry; score: number }[] = [];
  for (const entry of entries) {
    const path = entry.path.toLowerCase();
    if (!terms.every((t) => path.includes(t))) continue;
    const name = path.slice(path.lastIndexOf('/') + 1);
    const first = terms[0];
    const score = name.startsWith(first) ? 0 : name.includes(first) ? 1 : 2;
    scored.push({ entry, score });
  }
  scored.sort(
    (a, b) =>
      a.score - b.score ||
      a.entry.path.length - b.entry.path.length ||
      a.entry.path.localeCompare(b.entry.path, undefined, { numeric: true }),
  );
  return { matches: scored.slice(0, Math.max(0, limit)).map((s) => s.entry), total: scored.length };
}

/* ------------------------------------------------------------------ Persisted tabs */

/** Legacy (pre-host) key: it only ever held demo paths. */
export const EDITOR_STATE_KEY = 'orbit:editor:v1';

export type EditorMode = 'host' | 'demo';

/** Separate keys per mode, so demo paths never leak into the real machine's tab list (and back). */
export function editorStateKey(mode: EditorMode): string {
  return `${EDITOR_STATE_KEY}:${mode}`;
}

/** What survives a reload: which files were open (paths only — contents always come from the file store). */
export interface PersistedEditor {
  open: string[];
  active: string | null;
  sidebar?: boolean;
  wrap?: boolean;
}

function defaultStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Returns null when nothing (valid) was saved yet for this mode, i.e. on first launch. */
export function loadEditorState(
  storage: Storage | null = defaultStorage(),
  mode: EditorMode = 'demo',
): PersistedEditor | null {
  if (!storage) return null;
  try {
    // Demo mode falls back to the legacy key (written before host mode existed).
    const raw = storage.getItem(editorStateKey(mode)) ?? (mode === 'demo' ? storage.getItem(EDITOR_STATE_KEY) : null);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedEditor> | null;
    if (!parsed || !Array.isArray(parsed.open)) return null;
    const open = [...new Set(parsed.open.filter((p): p is string => typeof p === 'string' && p.length > 0))];
    const active = typeof parsed.active === 'string' && open.includes(parsed.active) ? parsed.active : (open[0] ?? null);
    return {
      open,
      active,
      sidebar: typeof parsed.sidebar === 'boolean' ? parsed.sidebar : undefined,
      wrap: typeof parsed.wrap === 'boolean' ? parsed.wrap : undefined,
    };
  } catch {
    return null;
  }
}

export function saveEditorState(
  state: PersistedEditor,
  storage: Storage | null = defaultStorage(),
  mode: EditorMode = 'demo',
): void {
  try {
    storage?.setItem(editorStateKey(mode), JSON.stringify(state));
  } catch {
    /* storage full or blocked: tab restore is a convenience, ignore */
  }
}

/* ------------------------------------------------------------------ Documents */

/**
 * The smallest single replacement turning `from` into `to` (common prefix/suffix trimmed),
 * so reloading a file keeps the cursor and undo history meaningful. Null when equal.
 */
export function minimalChange(from: string, to: string): { from: number; to: number; insert: string } | null {
  if (from === to) return null;
  let start = 0;
  const max = Math.min(from.length, to.length);
  while (start < max && from.charCodeAt(start) === to.charCodeAt(start)) start++;
  let end = 0;
  while (
    end < from.length - start &&
    end < to.length - start &&
    from.charCodeAt(from.length - 1 - end) === to.charCodeAt(to.length - 1 - end)
  )
    end++;
  return { from: start, to: from.length - end, insert: to.slice(start, to.length - end) };
}

/* ------------------------------------------------------------------ Paths */

/**
 * Validates a file name typed into New file / Rename. Returns an error message or null.
 * `existing` is the list of files in the project; `current` is the file being renamed (if any).
 */
export function validateNewPath(value: string, existing: readonly string[], current?: string): string | null {
  let p: string;
  try {
    p = normalizePath(value);
  } catch (err) {
    return (err as Error).message;
  }
  if (p === current) return null;
  if (existing.includes(p)) return `A file named "${p}" already exists.`;
  if (existing.some((e) => e.startsWith(p + '/'))) return `"${p}" is a folder. Add a file name, e.g. ${p}/new-file.txt`;
  // A parent segment can't be an existing file ("README.md/x").
  const parts = p.split('/');
  for (let i = 1; i < parts.length; i++) {
    const parent = parts.slice(0, i).join('/');
    if (existing.includes(parent)) return `"${parent}" is a file, not a folder.`;
  }
  return null;
}

/* ------------------------------------------------------------------ Storage wording */

type StoreInfo = Pick<FileStore, 'kind' | 'label' | 'truncated'>;

/** Persistent note in the file browser: where files live (from the store, never hard-coded). */
export function storageNote(store: StoreInfo): string {
  // The machine lists at most 5000 files; say so rather than silently hiding the rest.
  return store.truncated ? `${store.label}. Showing the first 5,000 files; use Terminal for the rest.` : store.label;
}

/** " on your Linux machine" / " in this browser" — appended to toasts such as "Saved app.py". */
export function whereSuffix(kind: FileStore['kind']): string {
  return kind === 'server' ? ' on your Linux machine' : ' in this browser';
}

export function savedMessage(name: string, kind: FileStore['kind']): string {
  return `Saved ${name}${whereSuffix(kind)}`;
}

/** Body of the delete confirmation. */
export function deleteWarning(kind: FileStore['kind']): string {
  return kind === 'server'
    ? 'will be deleted from your Linux machine. This can’t be undone.'
    : 'will be removed from this browser’s storage. This can’t be undone.';
}

/** A readable message for any error thrown by a file store (or anything else). */
export function errorMessage(err: unknown): string {
  if (err instanceof FileStoreError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return 'Something went wrong. Please try again.';
}

/** Missing files can't be fixed by trying again; everything else (network, I/O, server) can. */
export function isRetryable(err: unknown): boolean {
  return !(err instanceof FileStoreError && (err.code === 'not-found' || err.code === 'invalid-path'));
}

/* ------------------------------------------------------------------ Summary */

/** One line for the App Switcher. Must contain "unsaved" whenever there is unsaved work. */
export function editorSummary(tabs: { path: string; dirty: boolean }[], activePath: string | null): string {
  const dirty = tabs.filter((t) => t.dirty);
  if (dirty.length > 0) {
    const preferred = dirty.find((t) => t.path === activePath) ?? dirty[0];
    const name = preferred.path.slice(preferred.path.lastIndexOf('/') + 1);
    return dirty.length === 1 ? `${name} — unsaved changes` : `${name} and ${dirty.length - 1} more — unsaved changes`;
  }
  if (tabs.length === 0) return 'No file open';
  return `${tabs.length} file${tabs.length === 1 ? '' : 's'} open`;
}
