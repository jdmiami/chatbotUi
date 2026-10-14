import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorView, type ViewUpdate } from '@codemirror/view';
import type { EditorState, StateEffect } from '@codemirror/state';
import { indentLess, indentMore, redo, undo } from '@codemirror/commands';
import { openSearchPanel } from '@codemirror/search';
import type { AppProps } from '../types';
import { connection, getFileStore } from '../../services';
import { FileStoreError, normalizePath, type FileEntry } from '../../services/files/types';
import { useShell } from '../../state/shell';
import { useLayout } from '../../state/viewport';
import { useWorkspace } from '../../state/workspace';
import { Icon } from '../../ui/Icon';
import {
  AppHeader,
  ConfirmSheet,
  DemoChip,
  EmptyState,
  IconButton,
  PromptSheet,
  Sheet,
  Toggle,
} from '../../ui/components';
import { relativeTime, splitPath } from '../../ui/format';
import {
  createFileState,
  fileCompartment,
  fileExtension,
  reconfigureState,
  themeCompartment,
  themeExtension,
  wrapCompartment,
  wrapExtension,
  type EditorHooks,
} from './cm';
import { FileBrowser, type ListStatus } from './FileBrowser';
import { LANGUAGE_LABELS, languageIdForPath } from './language';
import {
  ancestorFolders,
  deleteWarning,
  editorSummary,
  errorMessage,
  foldersOpenByDefault,
  isFolderCollapsed,
  isRetryable,
  loadEditorState,
  minimalChange,
  savedMessage,
  saveEditorState,
  storageNote,
  validateNewPath,
  whereSuffix,
} from './model';
import { createCursorStore, EditorToolbar, type ToolbarCommand } from './Toolbar';
import './editor.css';

/** Unsaved-vs-disk state of an open file. */
type Conflict =
  | { kind: 'changed'; disk: string } // changed on disk while the tab has unsaved edits
  | { kind: 'deleted' }; // removed on disk; the buffer is kept as unsaved

interface Tab {
  path: string;
  dirty: boolean;
  conflict: Conflict | null;
}

type OpenResult = { ok: true } | { ok: false; error: unknown };

/** Files that couldn't be opened (network / server error, or missing). */
interface OpenError {
  paths: string[];
  message: string;
  retryable: boolean;
}

type Dialog =
  | { kind: 'browser' }
  | { kind: 'more' }
  | { kind: 'file-actions'; path: string }
  | { kind: 'new' }
  | { kind: 'rename'; path: string }
  | { kind: 'delete'; path: string; busy?: boolean; error?: string }
  | { kind: 'revert'; path: string }
  | { kind: 'close'; path: string }
  | null;

/** The sidebar docks only when the app is at least this wide; narrower layouts use a sheet. */
const DOCK_MIN_WIDTH = 720;

const nameOf = (path: string) => splitPath(path).name;

/**
 * Code: CodeMirror 6 editor over the project file store — files in this browser (demo mode) or
 * the real project on the Linux machine (host mode), always through getFileStore().
 *
 * One EditorView per app instance; one EditorState per open file kept in a ref map (so undo
 * history, selection and scroll survive tab switches). The component stays mounted while the app
 * is open, so unsaved buffers survive app switching; they are not persisted across reloads.
 */
export default function EditorApp({ placement, isActive, compact }: AppProps) {
  const store = useMemo(() => getFileStore(), []);
  const mode = connection.mode;
  const toast = useShell((s) => s.toast);
  const launch = useShell((s) => s.launch);
  const layout = useLayout();
  const intent = useWorkspace((s) => s.intent);
  const recentFiles = useWorkspace((s) => s.recentFiles);

  const persisted = useMemo(() => loadEditorState(undefined, mode), [mode]);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [listStatus, setListStatus] = useState<ListStatus>({ kind: 'loading' });
  const [rootName, setRootName] = useState(store.rootName);
  const [ready, setReady] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(persisted?.sidebar ?? true);
  const [wrap, setWrap] = useState(persisted?.wrap ?? true);
  /** Explicit folder open/closed choices; the default depends on the project size. */
  const [folderOverrides, setFolderOverrides] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const [query, setQuery] = useState('');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [saveError, setSaveError] = useState<{ path: string; message: string } | null>(null);
  const [openError, setOpenError] = useState<OpenError | null>(null);
  const [opening, setOpening] = useState<ReadonlySet<string>>(() => new Set());
  /** The file the user last asked to open, while it is still loading. */
  const [pendingFocus, setPendingFocus] = useState<string | null>(null);
  const [saving, setSaving] = useState<ReadonlySet<string>>(() => new Set());
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme !== 'light');
  const [width, setWidth] = useState(() => layout.width);

  const rootRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const tabsNavRef = useRef<HTMLElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  /** EditorState per open file. The active file's entry is stale while it is in the view. */
  const statesRef = useRef(new Map<string, EditorState>());
  /** Last saved/loaded content per open file (undefined = file no longer exists on disk). */
  const baselineRef = useRef(new Map<string, string>());
  /** updatedAt of the disk version each tab was last reconciled with (server: skips needless reads). */
  const stampRef = useRef(new Map<string, number>());
  const scrollRef = useRef(new Map<string, number>());
  const openingRef = useRef(new Map<string, Promise<OpenResult>>());
  /** Paths with a save / rename / delete in flight: external-change checks leave them alone. */
  const busyRef = useRef(new Set<string>());
  const savingRef = useRef(new Set<string>());
  const openSeq = useRef(0);
  const activeRef = useRef<string | null>(null);
  const tabsRef = useRef<Tab[]>([]);
  const darkRef = useRef(dark);
  const wrapRef = useRef(wrap);
  const restoreStarted = useRef(false);
  /** First launch whose file list failed: open README.md once the list loads. */
  const readmePending = useRef(false);
  const handledIntent = useRef<number | null>(null);
  const cursor = useMemo(() => createCursorStore(), []);

  /* ------------------------------------------------------------------ helpers (read refs only) */

  const commitTabs = (update: (prev: Tab[]) => Tab[]) => {
    const next = update(tabsRef.current);
    if (next === tabsRef.current) return;
    tabsRef.current = next;
    setTabs(next);
  };

  const patchTab = (path: string, patch: Partial<Tab>) =>
    commitTabs((prev) => {
      const i = prev.findIndex((t) => t.path === path);
      if (i < 0) return prev;
      const cur = prev[i];
      const next = { ...cur, ...patch };
      if (next.dirty === cur.dirty && next.conflict === cur.conflict && next.path === cur.path) return prev;
      const copy = prev.slice();
      copy[i] = next;
      return copy;
    });

  const docOf = (path: string) => {
    const view = viewRef.current;
    if (view && path === activeRef.current) return view.state.doc;
    return statesRef.current.get(path)?.doc;
  };
  const docText = (path: string) => docOf(path)?.toString();

  const computeDirty = (path: string): boolean => {
    const base = baselineRef.current.get(path);
    if (base === undefined) return true; // deleted elsewhere: the buffer is unsaved
    const doc = docOf(path);
    if (!doc) return false;
    return doc.length !== base.length || doc.toString() !== base;
  };

  const emptyState = () => createFileState('', '', { dark: darkRef.current, wrap: wrapRef.current, hooks });

  const syncOpening = () => setOpening(new Set(openingRef.current.keys()));
  const syncSaving = () => setSaving(new Set(savingRef.current));

  /* ------------------------------------------------------------------ actions */

  /** Fetch the file list. Returns null (and shows an error with Retry) when it fails. */
  async function loadList(): Promise<FileEntry[] | null> {
    try {
      const list = await store.list();
      setEntries(list);
      setRootName(store.rootName);
      setListStatus({ kind: 'ready' });
      return list;
    } catch (err) {
      setListStatus({ kind: 'error', message: errorMessage(err) });
      return null;
    }
  }

  /** Expand the folders containing a file so it's visible in the tree. */
  function reveal(path: string) {
    setFolderOverrides((prev) => {
      const folders = ancestorFolders(path).filter((f) => prev.get(f) !== true);
      if (folders.length === 0) return prev;
      const next = new Map(prev);
      folders.forEach((f) => next.set(f, true));
      return next;
    });
  }

  function activate(path: string | null) {
    const view = viewRef.current;
    const prev = activeRef.current;
    if (prev === path) {
      setActive(path);
      return;
    }
    if (view && prev && statesRef.current.has(prev)) {
      statesRef.current.set(prev, view.state);
      scrollRef.current.set(prev, view.scrollDOM.scrollTop);
    }
    activeRef.current = path;
    setActive(path);
    setSaveError((e) => (e && e.path !== path ? null : e));
    if (!view) return;
    const next = path ? statesRef.current.get(path) : undefined;
    view.setState(next ?? emptyState());
    cursor.update(view.state);
    if (path) {
      const top = scrollRef.current.get(path) ?? 0;
      requestAnimationFrame(() => {
        view.requestMeasure();
        view.scrollDOM.scrollTop = top;
      });
    }
  }

  /**
   * Open a file in a tab (reading it from the store if needed) and, unless `activate: false`,
   * show it. `quiet` suppresses the error banner (the caller reports failures itself).
   */
  async function openFile(raw: string, opts: { activate?: boolean; quiet?: boolean } = {}): Promise<OpenResult> {
    let path: string;
    try {
      path = normalizePath(raw);
    } catch (error) {
      if (!opts.quiet) setOpenError({ paths: [raw], message: errorMessage(error), retryable: false });
      return { ok: false, error };
    }
    const focus = opts.activate !== false;
    const seq = focus ? ++openSeq.current : 0;
    if (focus) setOpenError((e) => (e?.paths.includes(path) ? null : e));
    if (!tabsRef.current.some((t) => t.path === path)) {
      let pending = openingRef.current.get(path);
      if (!pending) {
        pending = (async (): Promise<OpenResult> => {
          try {
            const content = await store.read(path);
            if (!tabsRef.current.some((t) => t.path === path)) {
              statesRef.current.set(
                path,
                createFileState(path, content, { dark: darkRef.current, wrap: wrapRef.current, hooks }),
              );
              baselineRef.current.set(path, content);
              stampRef.current.delete(path);
              commitTabs((prev) => [...prev, { path, dirty: false, conflict: null }]);
            }
            return { ok: true };
          } catch (error) {
            return { ok: false, error };
          } finally {
            openingRef.current.delete(path);
            syncOpening();
          }
        })();
        openingRef.current.set(path, pending);
        syncOpening();
      }
      if (focus) setPendingFocus(path);
      const result = await pending;
      if (focus) setPendingFocus((p) => (p === path ? null : p));
      if (!result.ok) {
        if (result.error instanceof FileStoreError && result.error.code === 'not-found') {
          useWorkspace.getState().forgetFile(path);
        }
        if (!opts.quiet) {
          setOpenError({ paths: [path], message: errorMessage(result.error), retryable: isRetryable(result.error) });
        }
        return result;
      }
    }
    // Only the latest request wins (tapping B while A is still loading shows B).
    if (focus && seq === openSeq.current) {
      activate(path);
      reveal(path);
      useWorkspace.getState().noteFile(path);
    }
    return { ok: true };
  }

  /** Open several files in parallel (restoring tabs, Retry), keeping their order. */
  async function openMany(paths: string[], preferActive: string | null) {
    const results = await Promise.all(paths.map((p) => openFile(p, { activate: false, quiet: true })));
    const order = new Map(paths.map((p, i) => [p, i]));
    commitTabs((prev) => {
      const sorted = prev.slice().sort((a, b) => (order.get(a.path) ?? -1) - (order.get(b.path) ?? -1));
      return sorted.every((t, i) => t === prev[i]) ? prev : sorted;
    });
    const failed = paths.filter((_, i) => {
      const r = results[i];
      return !r.ok && isRetryable(r.error);
    });
    if (failed.length > 0) {
      const first = results.find((r) => !r.ok && isRetryable(r.error)) as { ok: false; error: unknown };
      setOpenError({ paths: failed, message: errorMessage(first.error), retryable: true });
    }
    const open = tabsRef.current.map((t) => t.path);
    if (!activeRef.current) {
      const want = preferActive && open.includes(preferActive) ? preferActive : (open[0] ?? null);
      if (want) {
        activate(want);
        useWorkspace.getState().noteFile(want);
      }
    }
  }

  async function retryOpen() {
    const err = openError;
    if (!err) return;
    setOpenError(null);
    if (listStatus.kind === 'error') retryList();
    if (err.paths.length === 1) await openFile(err.paths[0]);
    else await openMany(err.paths, persisted?.active ?? null);
  }

  function retryList() {
    setListStatus({ kind: 'loading' });
    queueRefresh();
  }

  function closeTab(path: string, force = false) {
    const tab = tabsRef.current.find((t) => t.path === path);
    if (!tab) return;
    if (!force && tab.dirty) {
      setDialog({ kind: 'close', path });
      return;
    }
    const index = tabsRef.current.indexOf(tab);
    const rest = tabsRef.current.filter((t) => t.path !== path);
    if (activeRef.current === path) {
      activeRef.current = null; // don't stash the closing file's state
      const next = rest[index] ?? rest[index - 1] ?? null;
      activate(next?.path ?? null);
    }
    statesRef.current.delete(path);
    baselineRef.current.delete(path);
    stampRef.current.delete(path);
    scrollRef.current.delete(path);
    commitTabs(() => rest);
    setSaveError((e) => (e?.path === path ? null : e));
  }

  async function save(path: string | null = activeRef.current): Promise<boolean> {
    if (!path || savingRef.current.has(path)) return false;
    const text = docText(path);
    if (text === undefined) return false;
    const name = nameOf(path);
    const prevBase = baselineRef.current.get(path);
    // Set the baseline first so our own store notification is recognised as "no change".
    baselineRef.current.set(path, text);
    savingRef.current.add(path);
    busyRef.current.add(path);
    syncSaving();
    try {
      await store.write(path, text);
      stampRef.current.delete(path);
      patchTab(path, { conflict: null, dirty: computeDirty(path) });
      setSaveError((e) => (e?.path === path ? null : e));
      toast(savedMessage(name, store.kind), 'success');
      return true;
    } catch (err) {
      if (prevBase === undefined) baselineRef.current.delete(path);
      else baselineRef.current.set(path, prevBase);
      const message = errorMessage(err);
      setSaveError({ path, message });
      toast(`Couldn't save ${name}. ${message}`, 'error');
      return false;
    } finally {
      savingRef.current.delete(path);
      busyRef.current.delete(path);
      syncSaving();
    }
  }

  /** Replace a buffer's text with the smallest edit (keeps cursor and undo history sensible). */
  function replaceDoc(path: string, content: string) {
    const view = viewRef.current;
    if (view && path === activeRef.current) {
      const change = minimalChange(view.state.doc.toString(), content);
      if (change) view.dispatch({ changes: change });
      return;
    }
    const state = statesRef.current.get(path);
    if (!state) return;
    const change = minimalChange(state.doc.toString(), content);
    if (change) statesRef.current.set(path, state.update({ changes: change }).state);
  }

  function loadFromDisk(path: string, content: string) {
    baselineRef.current.set(path, content);
    replaceDoc(path, content);
    patchTab(path, { dirty: false, conflict: null });
    setSaveError((e) => (e?.path === path ? null : e));
  }

  async function revert(path: string) {
    try {
      const disk = await store.read(path);
      loadFromDisk(path, disk);
      toast(`Reverted ${nameOf(path)} to the saved version`);
    } catch (err) {
      toast(`Couldn't revert ${nameOf(path)}: ${errorMessage(err)}`, 'error');
    }
  }

  function keepMine(path: string) {
    const tab = tabsRef.current.find((t) => t.path === path);
    if (tab?.conflict?.kind !== 'changed') return;
    // Compare against the new disk version from now on; the buffer stays unsaved until Save.
    baselineRef.current.set(path, tab.conflict.disk);
    patchTab(path, { conflict: null, dirty: computeDirty(path) });
  }

  /** Reconcile open tabs with the file store after any change (terminal, other tab/device, our own ops). */
  async function refreshFromStore() {
    const list = await loadList();
    if (!list) return;
    if (readmePending.current && list.some((e) => e.path === 'README.md')) {
      readmePending.current = false;
      if (tabsRef.current.length === 0) void openFile('README.md', { quiet: true });
    }
    const byPath = new Map(list.map((e) => [e.path, e]));
    for (const { path } of tabsRef.current.slice()) {
      if (busyRef.current.has(path)) continue;
      const tab = tabsRef.current.find((t) => t.path === path);
      if (!tab) continue;
      const entry = byPath.get(path);
      if (!entry) {
        if (tab.conflict?.kind !== 'deleted') {
          baselineRef.current.delete(path);
          stampRef.current.delete(path);
          patchTab(path, { conflict: { kind: 'deleted' }, dirty: true });
        }
        continue;
      }
      // Unchanged on the server since we last looked: no need to download it again.
      if (store.kind === 'server' && stampRef.current.get(path) === entry.updatedAt && tab.conflict?.kind !== 'deleted') {
        continue;
      }
      let disk: string;
      try {
        disk = await store.read(path);
      } catch {
        continue;
      }
      const now = tabsRef.current.find((t) => t.path === path);
      if (!now || busyRef.current.has(path)) continue; // closed or being saved meanwhile
      stampRef.current.set(path, entry.updatedAt);
      const base = baselineRef.current.get(path);
      if (disk === base) {
        if (now.conflict) patchTab(path, { conflict: null, dirty: computeDirty(path) });
        continue;
      }
      const current = docText(path);
      if (current === disk) {
        baselineRef.current.set(path, disk);
        patchTab(path, { conflict: null, dirty: false });
        continue;
      }
      const dirty = base === undefined || current !== base;
      if (!dirty) {
        loadFromDisk(path, disk); // clean tab: reload silently
      } else if (now.conflict?.kind !== 'changed' || now.conflict.disk !== disk) {
        patchTab(path, { conflict: { kind: 'changed', disk }, dirty: true });
      }
    }
  }

  function rekey(from: string, to: string) {
    for (const map of [statesRef.current, baselineRef.current, scrollRef.current, stampRef.current] as Map<
      string,
      unknown
    >[]) {
      if (map.has(from)) {
        map.set(to, map.get(from));
        map.delete(from);
      }
    }
    const effect = fileCompartment.reconfigure(fileExtension(to));
    if (activeRef.current === from) {
      activeRef.current = to;
      setActive(to);
      viewRef.current?.dispatch({ effects: effect });
    } else {
      const state = statesRef.current.get(to);
      if (state) statesRef.current.set(to, reconfigureState(state, effect));
    }
    commitTabs((prev) => prev.map((t) => (t.path === from ? { ...t, path: to } : t)));
    setSaveError((e) => (e?.path === from ? { ...e, path: to } : e));
  }

  async function renameFile(from: string, raw: string) {
    const to = normalizePath(raw);
    if (to === from) {
      setDialog(null);
      return;
    }
    const err = validateNewPath(to, entries.map((e) => e.path), from);
    if (err) throw new Error(err);
    if (busyRef.current.has(from)) throw new Error('This file is being saved. Try again in a moment.');
    const wasOpen = tabsRef.current.some((t) => t.path === from);
    busyRef.current.add(from);
    busyRef.current.add(to);
    // Re-key first so the store notification finds the tab under its new name.
    if (wasOpen) rekey(from, to);
    try {
      await store.rename(from, to);
    } catch (ex) {
      if (wasOpen) rekey(to, from);
      throw new Error(errorMessage(ex)); // shown inside the prompt; pressing Rename again retries
    } finally {
      busyRef.current.delete(from);
      busyRef.current.delete(to);
    }
    stampRef.current.delete(to);
    const ws = useWorkspace.getState();
    ws.forgetFile(from);
    if (wasOpen) ws.noteFile(to);
    reveal(to);
    setDialog(null);
    toast(`Renamed to ${to}`, 'success');
  }

  async function deleteFile(path: string) {
    if (busyRef.current.has(path)) {
      setDialog({ kind: 'delete', path, error: 'It is being saved right now. Try again in a moment.' });
      return;
    }
    busyRef.current.add(path);
    setDialog({ kind: 'delete', path, busy: true });
    try {
      await store.remove(path);
    } catch (err) {
      busyRef.current.delete(path);
      if (!(err instanceof FileStoreError && err.code === 'not-found')) {
        setDialog({ kind: 'delete', path, error: errorMessage(err) });
        return;
      }
      // Already gone: same outcome as deleting it.
    }
    closeTab(path, true);
    busyRef.current.delete(path);
    useWorkspace.getState().forgetFile(path);
    setDialog(null);
    toast(`Deleted ${nameOf(path)}`);
  }

  async function createFile(raw: string) {
    const err = validateNewPath(raw, entries.map((e) => e.path));
    if (err) throw new Error(err);
    const path = normalizePath(raw);
    try {
      await store.write(path, '');
    } catch (ex) {
      throw new Error(errorMessage(ex)); // shown inside the prompt; pressing Create again retries
    }
    setDialog(null);
    setQuery('');
    await openFile(path);
    toast(`Created ${path}${whereSuffix(store.kind)}`, 'success');
  }

  function askAgent(path: string) {
    const fromSheet = dialog !== null;
    setDialog(null);
    useWorkspace.getState().sendIntent({ app: 'agent', type: 'compose', text: `About \`${path}\`: ` });
    // In Code + Chat split view this just focuses the chat pane; otherwise it switches to Antigravity.
    // A closing sheet hands focus back to the button that opened it (inside Code), which would make
    // Code the focused pane again, so switch only after that has happened.
    if (fromSheet) setTimeout(() => launch('agent'), 0);
    else launch('agent');
  }

  function runCommand(cmd: ToolbarCommand) {
    const view = viewRef.current;
    if (!view || !activeRef.current) return;
    const commands = { undo, redo, indent: indentMore, outdent: indentLess, find: openSearchPanel };
    commands[cmd](view);
  }

  function onUpdate(update: ViewUpdate) {
    const path = activeRef.current;
    if (!path) return;
    if (update.docChanged) {
      const tab = tabsRef.current.find((t) => t.path === path);
      if (tab) {
        const dirty = computeDirty(path);
        if (tab.dirty !== dirty) patchTab(path, { dirty });
      }
    }
    if (update.docChanged || update.selectionSet) cursor.update(update.state);
  }

  // Latest action closures for callbacks created once (CodeMirror hooks, store subscription).
  const actions = useRef({ save, onUpdate, refreshFromStore, openFile, openMany, activate, loadList });
  actions.current = { save, onUpdate, refreshFromStore, openFile, openMany, activate, loadList };
  const hooksRef = useRef<EditorHooks | null>(null);
  hooksRef.current ??= {
    onSave: () => void actions.current.save(),
    onUpdate: (u) => actions.current.onUpdate(u),
  };
  const hooks = hooksRef.current;

  /** Coalesced, serialised refresh (store notifications can arrive in bursts). */
  const queueRefresh = useMemo(() => {
    let queued = false;
    let chain = Promise.resolve();
    return () => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        chain = chain.then(() => actions.current.refreshFromStore()).catch(() => undefined);
      });
    };
  }, []);

  const reconfigureAll = (effect: StateEffect<unknown>) => {
    for (const [path, state] of statesRef.current) {
      if (path !== activeRef.current) statesRef.current.set(path, reconfigureState(state, effect));
    }
    viewRef.current?.dispatch({ effects: effect });
  };

  /* ------------------------------------------------------------------ effects */

  // One EditorView for the lifetime of the app.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const current = activeRef.current;
    const view = new EditorView({
      state: (current && statesRef.current.get(current)) || emptyState(),
      parent: host,
    });
    viewRef.current = view;
    return () => {
      const cur = activeRef.current;
      if (cur && statesRef.current.has(cur)) statesRef.current.set(cur, view.state);
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Restore the tabs from the last visit in this mode (or open README.md on first launch).
  useEffect(() => {
    if (restoreStarted.current) return;
    restoreStarted.current = true;
    void (async () => {
      const list = await actions.current.loadList();
      let paths: string[] = [];
      if (persisted) paths = persisted.open;
      else if (list?.some((e) => e.path === 'README.md')) paths = ['README.md'];
      else if (!list) readmePending.current = true; // list failed: try again after Retry
      await actions.current.openMany(paths, persisted?.active ?? null);
      setReady(true);
    })();
  }, [persisted]);

  // React to changes made elsewhere (terminal, Antigravity, another tab or device, Settings → reset).
  useEffect(() => store.subscribe(queueRefresh), [store, queueRefresh]);

  // Cross-app "open this file" requests.
  useEffect(() => {
    if (!ready || !intent || intent.app !== 'editor' || intent.type !== 'open-file') return;
    if (handledIntent.current === intent.seq) return;
    handledIntent.current = intent.seq;
    const seq = intent.seq;
    void actions.current.openFile(intent.path).finally(() => useWorkspace.getState().consumeIntent(seq));
  }, [ready, intent]);

  // Hardware keyboard: ⌘S / Ctrl+S anywhere in the app (CodeMirror handles it first when focused).
  useEffect(() => {
    if (!isActive) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void actions.current.save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isActive]);

  // Theme follows <html data-theme>.
  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => setDark(root.dataset.theme !== 'light'));
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    setDark(root.dataset.theme !== 'light');
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (darkRef.current === dark) return;
    darkRef.current = dark;
    reconfigureAll(themeCompartment.reconfigure(themeExtension(dark)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dark]);
  useEffect(() => {
    if (wrapRef.current === wrap) return;
    wrapRef.current = wrap;
    reconfigureAll(wrapCompartment.reconfigure(wrapExtension(wrap)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wrap]);

  // Track our own width (split panes resize without a window resize).
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width);
      if (w > 0) setWidth((prev) => (Math.abs(prev - w) > 1 ? w : prev));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Re-measure when shown again or resized while hidden.
  useEffect(() => {
    if (placement === 'hidden') return;
    const view = viewRef.current;
    if (!view) return;
    const frame = requestAnimationFrame(() => view.requestMeasure());
    return () => cancelAnimationFrame(frame);
  }, [placement, compact, active, width, layout.height]);

  // Keep the cursor visible above the on-screen keyboard.
  useEffect(() => {
    const view = viewRef.current;
    if (!layout.keyboardOpen || !view?.hasFocus) return;
    const frame = requestAnimationFrame(() =>
      view.dispatch({ effects: EditorView.scrollIntoView(view.state.selection.main.head, { y: 'nearest', yMargin: 32 }) }),
    );
    return () => cancelAnimationFrame(frame);
  }, [layout.keyboardOpen, layout.height]);

  // Summary for the App Switcher.
  useEffect(() => {
    useWorkspace.getState().setSummary('editor', editorSummary(tabs, active));
  }, [tabs, active]);
  useEffect(() => () => useWorkspace.getState().setSummary('editor', undefined), []);

  // Remember which tabs were open (paths only), per mode. Files that failed to open with a
  // retryable error (machine briefly unreachable) stay in the list so a reload tries them again.
  useEffect(() => {
    if (!ready) return;
    const open = tabs.map((t) => t.path);
    const retry = openError?.retryable ? openError.paths.filter((p) => !open.includes(p)) : [];
    saveEditorState({ open: [...open, ...retry], active, sidebar: sidebarOpen, wrap }, undefined, mode);
  }, [ready, tabs, active, sidebarOpen, wrap, openError, mode]);

  // Unsaved buffers are not persisted: warn before the page unloads.
  const anyDirty = tabs.some((t) => t.dirty);
  useEffect(() => {
    if (!anyDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [anyDirty]);

  // Keep the active tab scrolled into view.
  useEffect(() => {
    const el = tabsNavRef.current?.querySelector<HTMLElement>('[aria-current="true"]');
    el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [active, tabs.length]);

  /* ------------------------------------------------------------------ render */

  const closeDialog = useCallback(() => setDialog(null), []);
  const activeTab = tabs.find((t) => t.path === active) ?? null;
  const activeSaving = !!active && saving.has(active);
  const docked = !compact && width >= DOCK_MIN_WIDTH;
  const showSidebar = docked && sidebarOpen;
  const tight = layout.keyboardOpen && layout.height < 520;
  const dirtyPaths = useMemo(() => new Set(tabs.filter((t) => t.dirty).map((t) => t.path)), [tabs]);
  const entryPaths = useMemo(() => new Set(entries.map((e) => e.path)), [entries]);
  const nameCounts = useMemo(() => {
    const counts = new Map<string, number>();
    tabs.forEach((t) => counts.set(nameOf(t.path), (counts.get(nameOf(t.path)) ?? 0) + 1));
    return counts;
  }, [tabs]);
  const recent = recentFiles.filter((f) => entryPaths.has(f.path)).slice(0, 5);
  const note = storageNote(store);
  const defaultOpen = foldersOpenByDefault(entries.length);

  const isCollapsed = useCallback(
    (folder: string) => isFolderCollapsed(folder, folderOverrides, defaultOpen),
    [folderOverrides, defaultOpen],
  );
  const toggleFolder = useCallback(
    (folder: string) =>
      setFolderOverrides((prev) => {
        const next = new Map(prev);
        next.set(folder, isFolderCollapsed(folder, prev, defaultOpen));
        return next;
      }),
    [defaultOpen],
  );
  const collapseAll = useCallback(() => {
    const folders = new Set<string>();
    entries.forEach((e) => ancestorFolders(e.path).forEach((f) => folders.add(f)));
    setFolderOverrides(new Map([...folders].map((f) => [f, false])));
  }, [entries]);

  const openBrowser = () => {
    if (docked) setSidebarOpen(true);
    else setDialog({ kind: 'browser' });
  };

  const browser = (variant: 'sidebar' | 'sheet') => (
    <FileBrowser
      variant={variant}
      entries={entries}
      status={listStatus}
      rootName={rootName}
      storageNote={note}
      activePath={active}
      dirtyPaths={dirtyPaths}
      openingPaths={opening}
      isCollapsed={isCollapsed}
      query={query}
      onQueryChange={setQuery}
      onToggleFolder={toggleFolder}
      onCollapseAll={collapseAll}
      onOpen={(p) => {
        if (variant === 'sheet') setDialog(null);
        void openFile(p);
      }}
      onNewFile={() => setDialog({ kind: 'new' })}
      onFileActions={(p) => setDialog({ kind: 'file-actions', path: p })}
      onRetry={retryList}
    />
  );

  const activeDir = active ? splitPath(active).dir : '';
  const chip =
    mode === 'demo' ? (
      <DemoChip text="Local files" title="Demo mode: files are stored in this browser only, not on your Linux machine." />
    ) : compact ? undefined : (
      <span className="chip ok" title={note}>
        <span className="dot" aria-hidden />
        Linux machine
      </span>
    );
  // (The docked sidebar shows the same error itself.)
  const listErrorBanner = listStatus.kind === 'error' && entries.length === 0 && !showSidebar && (
    <div className="banner error ed-banner ed-banner-standalone" role="alert">
      <Icon name="alert" size={18} />
      <div className="ed-banner-text">
        <strong>Couldn’t load the file list</strong>
        <span>{listStatus.message}</span>
      </div>
      <div className="ed-banner-actions">
        <button type="button" className="btn small primary" onClick={retryList}>
          Retry
        </button>
      </div>
    </div>
  );

  return (
    <div
      className="ed-root"
      ref={rootRef}
      data-placement={placement}
      data-compact={compact}
      data-tight={tight}
      data-active={isActive}
    >
      <AppHeader
        title={active ? nameOf(active) : 'Code'}
        subtitle={
          active ? (
            <span className="mono">
              {active}
              {activeTab?.dirty ? ' • Edited' : ''}
            </span>
          ) : (
            rootName
          )
        }
        chip={chip}
        actions={
          <>
            <IconButton
              icon={docked ? 'sidebar' : 'folder'}
              label={docked ? (sidebarOpen ? 'Hide files' : 'Show files') : 'Browse files'}
              pressed={docked ? sidebarOpen : undefined}
              onClick={() => (docked ? setSidebarOpen((v) => !v) : setDialog({ kind: 'browser' }))}
            />
            <IconButton
              icon="save"
              label={activeSaving ? 'Saving…' : 'Save file'}
              disabled={!activeTab?.dirty || activeSaving}
              onClick={() => void save()}
            />
            <IconButton icon="more" label="More actions" onClick={() => setDialog({ kind: 'more' })} />
          </>
        }
      />

      <div className="ed-main">
        {showSidebar && (
          <aside className="ed-sidebar" aria-label="Project files">
            {browser('sidebar')}
          </aside>
        )}

        <div className="ed-pane">
          {tabs.length > 0 && (
            <nav className="ed-tabs" aria-label="Open files" ref={tabsNavRef}>
              {tabs.map((t) => {
                const { name, dir } = splitPath(t.path);
                const isCurrent = t.path === active;
                return (
                  <div key={t.path} className="ed-tab" data-active={isCurrent}>
                    <button
                      type="button"
                      className="ed-tab-main"
                      aria-current={isCurrent ? 'true' : undefined}
                      title={t.path}
                      onClick={() => {
                        activate(t.path);
                        useWorkspace.getState().noteFile(t.path);
                      }}
                    >
                      <span className="ed-tab-name">{name}</span>
                      {(nameCounts.get(name) ?? 0) > 1 && <span className="ed-tab-dir">{dir || rootName}</span>}
                      {t.conflict && <Icon name="alert" size={14} className="ed-tab-warn" />}
                      {t.dirty && (
                        <>
                          <span className="ed-dot" aria-hidden />
                          <span className="visually-hidden">, unsaved changes</span>
                        </>
                      )}
                    </button>
                    <IconButton
                      icon="close"
                      iconSize={16}
                      label={`Close ${name}`}
                      className="ed-tab-close"
                      onClick={() => closeTab(t.path)}
                    />
                  </div>
                );
              })}
            </nav>
          )}

          {pendingFocus && (
            <div className="ed-status" role="status">
              <span className="ed-spinner" aria-hidden />
              <span className="ed-status-text">Opening {nameOf(pendingFocus)}…</span>
            </div>
          )}

          {openError && (
            <div className="banner error ed-banner" role="alert">
              <Icon name="alert" size={18} />
              <div className="ed-banner-text">
                <strong>
                  Couldn’t open{' '}
                  {openError.paths.length === 1 ? nameOf(openError.paths[0]) : `${openError.paths.length} files`}
                </strong>
                <span>{openError.message}</span>
              </div>
              <div className="ed-banner-actions">
                <button type="button" className="btn small ghost" onClick={() => setOpenError(null)}>
                  Dismiss
                </button>
                {openError.retryable && (
                  <button type="button" className="btn small primary" onClick={() => void retryOpen()}>
                    Retry
                  </button>
                )}
              </div>
            </div>
          )}

          {activeTab?.conflict?.kind === 'changed' && (
            <div className="banner info ed-banner" role="status">
              <Icon name="alert" size={18} />
              <div className="ed-banner-text">
                <strong>This file changed elsewhere</strong>
                <span>Reload the saved version, or keep your unsaved edits (saving will overwrite the other change).</span>
              </div>
              <div className="ed-banner-actions">
                <button
                  type="button"
                  className="btn small ghost"
                  onClick={() => activeTab.conflict?.kind === 'changed' && loadFromDisk(activeTab.path, activeTab.conflict.disk)}
                >
                  Reload
                </button>
                <button type="button" className="btn small primary" onClick={() => keepMine(activeTab.path)}>
                  Keep mine
                </button>
              </div>
            </div>
          )}
          {activeTab?.conflict?.kind === 'deleted' && (
            <div className="banner error ed-banner" role="status">
              <Icon name="alert" size={18} />
              <div className="ed-banner-text">
                <strong>This file was deleted elsewhere</strong>
                <span>Your text is kept here as unsaved changes. Save to create the file again.</span>
              </div>
              <div className="ed-banner-actions">
                <button type="button" className="btn small ghost" onClick={() => closeTab(activeTab.path)}>
                  Close tab
                </button>
                <button
                  type="button"
                  className="btn small primary"
                  disabled={activeSaving}
                  onClick={() => void save(activeTab.path)}
                >
                  Save again
                </button>
              </div>
            </div>
          )}
          {saveError && saveError.path === active && (
            <div className="banner error ed-banner" role="alert">
              <Icon name="alert" size={18} />
              <div className="ed-banner-text">
                <strong>Couldn’t save {nameOf(saveError.path)}</strong>
                <span>{saveError.message}</span>
              </div>
              <div className="ed-banner-actions">
                <button type="button" className="btn small ghost" onClick={() => setSaveError(null)}>
                  Dismiss
                </button>
                <button
                  type="button"
                  className="btn small primary"
                  disabled={activeSaving}
                  onClick={() => void save(saveError.path)}
                >
                  Try again
                </button>
              </div>
            </div>
          )}

          <div className="ed-cm" ref={hostRef} hidden={!active} />

          {!active && (
            <div className="ed-empty">
              {!ready ? (
                <EmptyState icon="code" title={listStatus.kind === 'loading' ? 'Loading files…' : 'Opening files…'} />
              ) : (
                <>
                  {listErrorBanner}
                  <EmptyState
                    icon="code"
                    title="No file open"
                    action={
                      <div className="row-inline ed-empty-actions">
                        <button type="button" className="btn primary" onClick={openBrowser}>
                          <Icon name="folder" size={18} />
                          Browse files
                        </button>
                        <button type="button" className="btn ghost" onClick={() => setDialog({ kind: 'new' })}>
                          <Icon name="plus" size={18} />
                          New file
                        </button>
                      </div>
                    }
                  >
                    Open a file from {rootName} or create a new one. {note}.
                  </EmptyState>
                  {recent.length > 0 && (
                    <section className="ed-recent" aria-labelledby="ed-recent-title">
                      <h2 className="list-title" id="ed-recent-title">
                        Recent files
                      </h2>
                      <div className="list">
                        {recent.map((f) => (
                          <button key={f.path} type="button" className="row" onClick={() => void openFile(f.path)}>
                            <Icon name="file" size={20} />
                            <span className="row-main">
                              <span className="row-title">{nameOf(f.path)}</span>
                              <span className="row-sub mono">
                                {f.path} · opened {relativeTime(f.at)}
                              </span>
                            </span>
                            <Icon name="forward" size={18} />
                          </button>
                        ))}
                      </div>
                    </section>
                  )}
                </>
              )}
            </div>
          )}

          {active && (
            <EditorToolbar
              cursor={cursor}
              compact={compact}
              language={LANGUAGE_LABELS[languageIdForPath(active)]}
              dirty={!!activeTab?.dirty}
              saving={activeSaving}
              onCommand={runCommand}
              onSave={() => void save()}
              onAsk={() => askAgent(active)}
            />
          )}
        </div>
      </div>

      {/* ------------------------------------------------------------ dialogs */}
      {dialog?.kind === 'browser' && (
        <Sheet title="Files" onClose={closeDialog}>
          {browser('sheet')}
        </Sheet>
      )}

      {dialog?.kind === 'more' && (
        <Sheet title={active ? nameOf(active) : 'Code'} onClose={closeDialog}>
          <div className="stack">
            <div className="list">
              <button type="button" className="row" onClick={() => setDialog({ kind: 'new' })}>
                <Icon name="plus" />
                <span className="row-main">New file…</span>
              </button>
              <button
                type="button"
                className="row"
                disabled={!active}
                onClick={() => active && setDialog({ kind: 'rename', path: active })}
              >
                <Icon name="pencil" />
                <span className="row-main">Rename…</span>
              </button>
              <button
                type="button"
                className="row"
                disabled={!activeTab?.dirty || activeTab.conflict?.kind === 'deleted'}
                onClick={() => active && setDialog({ kind: 'revert', path: active })}
              >
                <Icon name="history" />
                <span className="row-main">
                  <span className="row-title">Revert to saved…</span>
                  <span className="row-sub">Discard unsaved changes</span>
                </span>
              </button>
              <button
                type="button"
                className="row ed-row-danger"
                disabled={!active || activeTab?.conflict?.kind === 'deleted'}
                onClick={() => active && setDialog({ kind: 'delete', path: active })}
              >
                <Icon name="trash" />
                <span className="row-main">Delete…</span>
              </button>
            </div>
            <div className="list">
              <button type="button" className="row" disabled={!active} onClick={() => active && askAgent(active)}>
                <Icon name="sparkle" />
                <span className="row-main">
                  <span className="row-title">Ask Antigravity about this file</span>
                  <span className="row-sub">
                    {mode === 'demo' ? 'Starts a message in Antigravity (demo replies)' : 'Starts a message in Antigravity'}
                  </span>
                </span>
              </button>
            </div>
            <div className="list">
              <label className="row ed-toggle-row">
                <span className="row-main">Wrap long lines</span>
                <Toggle checked={wrap} onChange={setWrap} label="Wrap long lines" />
              </label>
            </div>
            <p className="list-caption ed-more-note">
              <Icon name="lock" size={14} /> {note}. Shortcuts: <span className="kbd">⌘S</span> save,{' '}
              <span className="kbd">⌘F</span> find, <span className="kbd">⌘Z</span> undo, <span className="kbd">Tab</span>{' '}
              indent (press <span className="kbd">Esc</span> then <span className="kbd">Tab</span> to leave the editor).
            </p>
          </div>
        </Sheet>
      )}

      {dialog?.kind === 'file-actions' && (
        <Sheet title={nameOf(dialog.path)} onClose={closeDialog}>
          <div className="stack">
            <p className="muted mono ed-sheet-path">{dialog.path}</p>
            <div className="list">
              <button
                type="button"
                className="row"
                onClick={() => {
                  const p = dialog.path;
                  setDialog(null);
                  void openFile(p);
                }}
              >
                <Icon name="file" />
                <span className="row-main">Open</span>
              </button>
              <button type="button" className="row" onClick={() => setDialog({ kind: 'rename', path: dialog.path })}>
                <Icon name="pencil" />
                <span className="row-main">Rename…</span>
              </button>
              <button type="button" className="row" onClick={() => askAgent(dialog.path)}>
                <Icon name="sparkle" />
                <span className="row-main">Ask Antigravity about this file</span>
              </button>
              <button
                type="button"
                className="row ed-row-danger"
                onClick={() => setDialog({ kind: 'delete', path: dialog.path })}
              >
                <Icon name="trash" />
                <span className="row-main">Delete…</span>
              </button>
            </div>
          </div>
        </Sheet>
      )}

      {dialog?.kind === 'new' && (
        <PromptSheet
          title="New file"
          label={`Path inside ${rootName}`}
          initial={activeDir ? `${activeDir}/` : ''}
          placeholder="src/new-file.ts"
          confirmLabel="Create"
          validate={(v) => validateNewPath(v, entries.map((e) => e.path))}
          onSubmit={createFile}
          onCancel={closeDialog}
        />
      )}

      {dialog?.kind === 'rename' && (
        <PromptSheet
          title={`Rename ${nameOf(dialog.path)}`}
          label="New path"
          initial={dialog.path}
          confirmLabel="Rename"
          validate={(v) => validateNewPath(v, entries.map((e) => e.path), dialog.path)}
          onSubmit={(v) => renameFile(dialog.path, v)}
          onCancel={closeDialog}
        />
      )}

      {dialog?.kind === 'delete' && (
        <ConfirmSheet
          title={`Delete ${nameOf(dialog.path)}?`}
          message={
            <>
              <span className="mono">{dialog.path}</span> {deleteWarning(store.kind)}
              {dirtyPaths.has(dialog.path) ? ' Unsaved changes will be lost too.' : ''}
              {dialog.error && (
                <span className="ed-sheet-error" role="alert">
                  Couldn’t delete it: {dialog.error}
                </span>
              )}
            </>
          }
          confirmLabel={dialog.busy ? 'Deleting…' : dialog.error ? 'Try again' : 'Delete'}
          destructive
          onConfirm={() => {
            if (!dialog.busy) void deleteFile(dialog.path);
          }}
          onCancel={closeDialog}
        />
      )}

      {dialog?.kind === 'revert' && (
        <ConfirmSheet
          title={`Revert ${nameOf(dialog.path)}?`}
          message="Your unsaved changes will be discarded and the last saved version reloaded."
          confirmLabel="Revert"
          destructive
          onConfirm={() => {
            const p = dialog.path;
            setDialog(null);
            void revert(p);
          }}
          onCancel={closeDialog}
        />
      )}

      {dialog?.kind === 'close' && (
        <ConfirmSheet
          title="Discard changes?"
          message={`${nameOf(dialog.path)} has unsaved changes. Closing the tab discards them.`}
          confirmLabel="Discard"
          destructive
          onConfirm={() => {
            const p = dialog.path;
            setDialog(null);
            closeTab(p, true);
          }}
          onCancel={closeDialog}
        />
      )}
    </div>
  );
}
