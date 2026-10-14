import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { EditorView, type ViewUpdate } from '@codemirror/view';
import type { EditorState, StateEffect } from '@codemirror/state';
import { indentLess, indentMore, redo, undo } from '@codemirror/commands';
import { openSearchPanel } from '@codemirror/search';
import type { AppProps } from '../types';
import { getFileStore } from '../../services';
import { FileStoreError, normalizePath, type FileEntry, type FileStore } from '../../services/files/types';
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
import { FileBrowser } from './FileBrowser';
import { LANGUAGE_LABELS, languageIdForPath } from './language';
import { editorSummary, loadEditorState, minimalChange, saveEditorState, validateNewPath } from './model';
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

type Dialog =
  | { kind: 'browser' }
  | { kind: 'more' }
  | { kind: 'file-actions'; path: string }
  | { kind: 'new' }
  | { kind: 'rename'; path: string }
  | { kind: 'delete'; path: string }
  | { kind: 'revert'; path: string }
  | { kind: 'close'; path: string }
  | null;

/** The sidebar docks only when the app is at least this wide; narrower layouts use a sheet. */
const DOCK_MIN_WIDTH = 720;

/** Persistent storage disclosure shown in the file browser. */
function storageNote(store: FileStore): string {
  return store.kind === 'browser-local'
    ? 'Saved in this browser only — not synced to your other devices'
    : store.label;
}

const nameOf = (path: string) => splitPath(path).name;

/**
 * Code: CodeMirror 6 editor over the project file store (browser-local in Phase 1).
 *
 * One EditorView per app instance; one EditorState per open file kept in a ref map (so undo
 * history, selection and scroll survive tab switches). The component stays mounted while the app
 * is open, so unsaved buffers survive app switching; they are not persisted across reloads.
 */
export default function EditorApp({ placement, isActive, compact }: AppProps) {
  const store = useMemo(() => getFileStore(), []);
  const toast = useShell((s) => s.toast);
  const launch = useShell((s) => s.launch);
  const layout = useLayout();
  const intent = useWorkspace((s) => s.intent);
  const recentFiles = useWorkspace((s) => s.recentFiles);

  const persisted = useMemo(() => loadEditorState(), []);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(true);
  const [ready, setReady] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(persisted?.sidebar ?? true);
  const [wrap, setWrap] = useState(persisted?.wrap ?? true);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [dialog, setDialog] = useState<Dialog>(null);
  const [saveError, setSaveError] = useState<{ path: string; message: string } | null>(null);
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
  const scrollRef = useRef(new Map<string, number>());
  const openingRef = useRef(new Map<string, Promise<boolean>>());
  const activeRef = useRef<string | null>(null);
  const tabsRef = useRef<Tab[]>([]);
  const darkRef = useRef(dark);
  const wrapRef = useRef(wrap);
  const restoreStarted = useRef(false);
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

  /* ------------------------------------------------------------------ actions */

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

  async function openFile(raw: string, opts: { activate?: boolean; quiet?: boolean } = {}): Promise<boolean> {
    let path: string;
    try {
      path = normalizePath(raw);
    } catch (err) {
      if (!opts.quiet) toast((err as Error).message, 'error');
      return false;
    }
    const focus = opts.activate !== false;
    if (!tabsRef.current.some((t) => t.path === path)) {
      let pending = openingRef.current.get(path);
      if (!pending) {
        pending = (async () => {
          try {
            const content = await store.read(path);
            if (!tabsRef.current.some((t) => t.path === path)) {
              statesRef.current.set(
                path,
                createFileState(path, content, { dark: darkRef.current, wrap: wrapRef.current, hooks }),
              );
              baselineRef.current.set(path, content);
              commitTabs((prev) => [...prev, { path, dirty: false, conflict: null }]);
            }
            return true;
          } catch (err) {
            if (!opts.quiet) toast(`Couldn't open ${path}: ${(err as Error).message}`, 'error');
            if (err instanceof FileStoreError && err.code === 'not-found') useWorkspace.getState().forgetFile(path);
            return false;
          } finally {
            openingRef.current.delete(path);
          }
        })();
        openingRef.current.set(path, pending);
      }
      if (!(await pending)) return false;
    }
    if (focus) {
      activate(path);
      useWorkspace.getState().noteFile(path);
    }
    return true;
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
    scrollRef.current.delete(path);
    commitTabs(() => rest);
    setSaveError((e) => (e?.path === path ? null : e));
  }

  async function save(path: string | null = activeRef.current): Promise<boolean> {
    if (!path) return false;
    const text = docText(path);
    if (text === undefined) return false;
    const name = nameOf(path);
    const prevBase = baselineRef.current.get(path);
    // Set the baseline first so our own store notification is recognised as "no change".
    baselineRef.current.set(path, text);
    try {
      await store.write(path, text);
      patchTab(path, { conflict: null, dirty: computeDirty(path) });
      setSaveError((e) => (e?.path === path ? null : e));
      toast(`Saved ${name} (in this browser)`, 'success');
      return true;
    } catch (err) {
      if (prevBase === undefined) baselineRef.current.delete(path);
      else baselineRef.current.set(path, prevBase);
      const message = err instanceof FileStoreError ? err.message : `Unexpected error: ${(err as Error).message}`;
      setSaveError({ path, message });
      toast(`Couldn't save ${name}. ${message}`, 'error');
      return false;
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
      toast(`Couldn't revert ${nameOf(path)}: ${(err as Error).message}`, 'error');
    }
  }

  function keepMine(path: string) {
    const tab = tabsRef.current.find((t) => t.path === path);
    if (tab?.conflict?.kind !== 'changed') return;
    // Compare against the new disk version from now on; the buffer stays unsaved until Save.
    baselineRef.current.set(path, tab.conflict.disk);
    patchTab(path, { conflict: null, dirty: computeDirty(path) });
  }

  /** Reconcile open tabs with the file store after any change (terminal, other browser tab, our own ops). */
  async function refreshFromStore() {
    let list: FileEntry[];
    try {
      list = await store.list();
    } catch {
      return;
    }
    setEntries(list);
    setLoadingEntries(false);
    const existing = new Set(list.map((e) => e.path));
    for (const { path } of tabsRef.current) {
      const tab = tabsRef.current.find((t) => t.path === path);
      if (!tab) continue;
      if (!existing.has(path)) {
        if (tab.conflict?.kind !== 'deleted') {
          baselineRef.current.delete(path);
          patchTab(path, { conflict: { kind: 'deleted' }, dirty: true });
        }
        continue;
      }
      let disk: string;
      try {
        disk = await store.read(path);
      } catch {
        continue;
      }
      const now = tabsRef.current.find((t) => t.path === path);
      if (!now) continue; // closed meanwhile
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
    for (const map of [statesRef.current, baselineRef.current, scrollRef.current] as Map<string, unknown>[]) {
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
    const wasOpen = tabsRef.current.some((t) => t.path === from);
    // Re-key first so the store notification finds the tab under its new name.
    if (wasOpen) rekey(from, to);
    try {
      await store.rename(from, to);
    } catch (ex) {
      if (wasOpen) rekey(to, from);
      throw ex; // shown inside the prompt
    }
    const ws = useWorkspace.getState();
    ws.forgetFile(from);
    if (wasOpen) ws.noteFile(to);
    setDialog(null);
    toast(`Renamed to ${to}`, 'success');
  }

  async function deleteFile(path: string) {
    setDialog(null);
    closeTab(path, true);
    try {
      await store.remove(path);
      useWorkspace.getState().forgetFile(path);
      toast(`Deleted ${nameOf(path)}`);
    } catch (err) {
      toast(`Couldn't delete ${nameOf(path)}: ${(err as Error).message}`, 'error');
    }
  }

  async function createFile(raw: string) {
    const err = validateNewPath(raw, entries.map((e) => e.path));
    if (err) throw new Error(err);
    const path = normalizePath(raw);
    await store.write(path, '');
    setDialog(null);
    // Make sure the new file is visible in the tree.
    setCollapsed((prev) => {
      const next = new Set(prev);
      const parts = path.split('/');
      for (let i = 1; i < parts.length; i++) next.delete(parts.slice(0, i).join('/'));
      return next;
    });
    await openFile(path);
    toast(`Created ${path} (in this browser)`, 'success');
  }

  function askAgent(path: string) {
    setDialog(null);
    useWorkspace.getState().sendIntent({ app: 'agent', type: 'compose', text: `About \`${path}\`: ` });
    // In Code + Chat split view this just focuses the chat pane; otherwise it switches to Antigravity.
    launch('agent');
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
  const actions = useRef({ save, onUpdate, refreshFromStore, openFile, activate });
  actions.current = { save, onUpdate, refreshFromStore, openFile, activate };
  const hooksRef = useRef<EditorHooks | null>(null);
  hooksRef.current ??= {
    onSave: () => void actions.current.save(),
    onUpdate: (u) => actions.current.onUpdate(u),
  };
  const hooks = hooksRef.current;

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

  // Restore the tabs from the last visit (or open README.md on first launch).
  useEffect(() => {
    if (restoreStarted.current) return;
    restoreStarted.current = true;
    void (async () => {
      let list: FileEntry[] = [];
      try {
        list = await store.list();
      } catch {
        /* storage blocked: start empty */
      }
      setEntries(list);
      setLoadingEntries(false);
      const paths = persisted
        ? persisted.open
        : list.some((e) => e.path === 'README.md')
          ? ['README.md']
          : list.slice(0, 1).map((e) => e.path);
      for (const p of paths) await actions.current.openFile(p, { activate: false, quiet: true });
      const open = tabsRef.current.map((t) => t.path);
      const want = persisted?.active && open.includes(persisted.active) ? persisted.active : (open[0] ?? null);
      if (want) actions.current.activate(want);
      setReady(true);
    })();
  }, [store, persisted]);

  // React to changes made elsewhere (terminal, another browser tab, Settings → reset).
  useEffect(() => {
    let queued = false;
    let chain = Promise.resolve();
    return store.subscribe(() => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        chain = chain.then(() => actions.current.refreshFromStore()).catch(() => undefined);
      });
    });
  }, [store]);

  // Cross-app "open this file" requests.
  useEffect(() => {
    if (!ready || !intent || intent.app !== 'editor' || intent.type !== 'open-file') return;
    if (handledIntent.current === intent.seq) return;
    handledIntent.current = intent.seq;
    const seq = intent.seq;
    void actions.current.openFile(intent.path).finally(() => useWorkspace.getState().consumeIntent(seq));
  }, [ready, intent]);

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

  // Remember which tabs were open (paths only).
  useEffect(() => {
    if (!ready) return;
    saveEditorState({ open: tabs.map((t) => t.path), active, sidebar: sidebarOpen, wrap });
  }, [ready, tabs, active, sidebarOpen, wrap]);

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

  const toggleFolder = useCallback((path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const openBrowser = () => {
    if (docked) setSidebarOpen(true);
    else setDialog({ kind: 'browser' });
  };

  const onRootKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented) return; // CodeMirror already handled Mod-s
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') {
      e.preventDefault();
      void save();
    }
  };

  const browser = (variant: 'sidebar' | 'sheet') => (
    <FileBrowser
      variant={variant}
      entries={entries}
      loading={loadingEntries}
      rootName={store.rootName}
      storageNote={note}
      activePath={active}
      dirtyPaths={dirtyPaths}
      collapsed={collapsed}
      onToggleFolder={toggleFolder}
      onOpen={(p) => {
        if (variant === 'sheet') setDialog(null);
        void openFile(p);
      }}
      onNewFile={() => setDialog({ kind: 'new' })}
      onFileActions={(p) => setDialog({ kind: 'file-actions', path: p })}
    />
  );

  const activeDir = active ? splitPath(active).dir : '';

  return (
    <div
      className="ed-root"
      ref={rootRef}
      data-placement={placement}
      data-compact={compact}
      data-tight={tight}
      data-active={isActive}
      onKeyDown={onRootKeyDown}
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
            store.rootName
          )
        }
        chip={<DemoChip text="Local files" title="Files are stored in this browser only" />}
        actions={
          <>
            <IconButton
              icon={docked ? 'sidebar' : 'folder'}
              label={docked ? (sidebarOpen ? 'Hide files' : 'Show files') : 'Browse files'}
              pressed={docked ? sidebarOpen : undefined}
              onClick={() => (docked ? setSidebarOpen((v) => !v) : setDialog({ kind: 'browser' }))}
            />
            <IconButton icon="save" label="Save file" disabled={!activeTab?.dirty} onClick={() => void save()} />
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
                      onClick={() => activate(t.path)}
                    >
                      <span className="ed-tab-name">{name}</span>
                      {(nameCounts.get(name) ?? 0) > 1 && <span className="ed-tab-dir">{dir || store.rootName}</span>}
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
                <button type="button" className="btn small primary" onClick={() => void save(activeTab.path)}>
                  Save again
                </button>
              </div>
            </div>
          )}
          {saveError && saveError.path === active && (
            <div className="banner error ed-banner" role="alert">
              <Icon name="alert" size={18} />
              <div className="ed-banner-text">
                <strong>Couldn't save {nameOf(saveError.path)}</strong>
                <span>{saveError.message}</span>
              </div>
              <div className="ed-banner-actions">
                <button type="button" className="btn small ghost" onClick={() => setSaveError(null)}>
                  Dismiss
                </button>
                <button type="button" className="btn small primary" onClick={() => void save(saveError.path)}>
                  Try again
                </button>
              </div>
            </div>
          )}

          <div className="ed-cm" ref={hostRef} hidden={!active} />

          {!active && (
            <div className="ed-empty">
              {!ready ? (
                <EmptyState icon="code" title="Opening files…" />
              ) : (
                <>
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
                    Open a file from {store.rootName} or create a new one. {note}.
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
                  <span className="row-sub">Starts a message in Antigravity (demo replies)</span>
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
          label={`Path inside ${store.rootName}`}
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
              <span className="mono">{dialog.path}</span> will be removed from this browser&apos;s storage. This can&apos;t
              be undone.
              {dirtyPaths.has(dialog.path) ? ' Unsaved changes will be lost too.' : ''}
            </>
          }
          confirmLabel="Delete"
          destructive
          onConfirm={() => void deleteFile(dialog.path)}
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
