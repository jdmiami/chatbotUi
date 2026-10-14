/**
 * Pure helpers for the Code app (no React, no CodeMirror) so they can be unit tested:
 * the project tree, persisted tab list, minimal document diffs, path validation and the
 * App Switcher summary.
 */
import { normalizePath, type FileEntry } from '../../services/files/types';

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

/** The rows a tree view shows, skipping the contents of collapsed folders. */
export function visibleRows(nodes: TreeNode[], collapsed: ReadonlySet<string>, depth = 0): TreeRow[] {
  const rows: TreeRow[] = [];
  for (const node of nodes) {
    rows.push({ node, depth });
    if (node.kind === 'folder' && !collapsed.has(node.path)) rows.push(...visibleRows(node.children, collapsed, depth + 1));
  }
  return rows;
}

/* ------------------------------------------------------------------ Persisted tabs */

export const EDITOR_STATE_KEY = 'orbit:editor:v1';

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

/** Returns null when nothing (valid) was saved yet, i.e. on first launch. */
export function loadEditorState(storage: Storage | null = defaultStorage()): PersistedEditor | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(EDITOR_STATE_KEY);
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

export function saveEditorState(state: PersistedEditor, storage: Storage | null = defaultStorage()): void {
  try {
    storage?.setItem(EDITOR_STATE_KEY, JSON.stringify(state));
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
