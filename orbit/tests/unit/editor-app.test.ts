/**
 * EditorApp against a fake *server* file store (host mode): async calls that can fail, the
 * machine's root name, honest labels, loading/error states with Retry, external changes,
 * per-mode tab persistence and cross-app intents.
 */
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { FileStoreError, type FileEntry, type FileStore } from '../../src/services/files/types';

/* ------------------------------------------------------------------ fake services */

class FakeServerStore implements FileStore {
  readonly kind = 'server' as const;
  readonly label = 'Saved on your Linux machine';
  rootName = 'projects';
  files = new Map<string, { content: string; updatedAt: number }>();
  failList = 0;
  failRead = new Map<string, number>();
  failWrite = 0;
  reads: string[] = [];
  private listeners = new Set<() => void>();
  private clock = 1_000;

  constructor(seed: Record<string, string>) {
    for (const [p, c] of Object.entries(seed)) this.files.set(p, { content: c, updatedAt: this.clock++ });
  }
  async list(): Promise<FileEntry[]> {
    await Promise.resolve();
    if (this.failList > 0) {
      this.failList--;
      throw new FileStoreError('Could not reach the Linux machine. Check that it is on.', 'io');
    }
    this.rootName = 'my-project';
    return [...this.files].map(([path, f]) => ({ path, size: f.content.length, updatedAt: f.updatedAt }));
  }
  async read(path: string): Promise<string> {
    await Promise.resolve();
    this.reads.push(path);
    const n = this.failRead.get(path) ?? 0;
    if (n > 0) {
      this.failRead.set(path, n - 1);
      throw new FileStoreError('Request failed (502)', 'io');
    }
    const f = this.files.get(path);
    if (!f) throw new FileStoreError(`No such file: ${path}`, 'not-found');
    return f.content;
  }
  async write(path: string, content: string): Promise<void> {
    await Promise.resolve();
    if (this.failWrite > 0) {
      this.failWrite--;
      throw new FileStoreError('Request failed (500)', 'io');
    }
    this.files.set(path, { content, updatedAt: this.clock++ });
    this.emit();
  }
  async rename(from: string, to: string): Promise<void> {
    const f = this.files.get(from);
    if (!f) throw new FileStoreError('missing', 'not-found');
    this.files.delete(from);
    this.files.set(to, { ...f, updatedAt: this.clock++ });
    this.emit();
  }
  async remove(path: string): Promise<void> {
    if (!this.files.delete(path)) throw new FileStoreError('missing', 'not-found');
    this.emit();
  }
  /** A change made elsewhere (terminal, Antigravity, another device). */
  external(path: string, content: string | null) {
    if (content === null) this.files.delete(path);
    else this.files.set(path, { content, updatedAt: this.clock++ });
    this.emit();
  }
  subscribe(l: () => void) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  emit() {
    this.listeners.forEach((l) => l());
  }
  reset() {}
}

const services = vi.hoisted(() => ({
  store: null as unknown as FileStore,
  connection: { mode: 'host' as 'host' | 'demo', label: 'Linux machine', detail: '' },
}));

vi.mock('../../src/services', () => ({
  get connection() {
    return services.connection;
  },
  getFileStore: () => services.store,
}));

// Imported after the mock is registered.
const { default: EditorApp } = await import('../../src/apps/editor/EditorApp');
const { useShell } = await import('../../src/state/shell');
const { useWorkspace } = await import('../../src/state/workspace');

/* ------------------------------------------------------------------ helpers */

// jsdom has no layout; CodeMirror only needs these to exist.
if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
}

function renderEditor() {
  return render(createElement(EditorApp, { placement: 'full', isActive: true, compact: false }));
}

function view(): EditorView {
  const el = document.querySelector('.cm-editor') as HTMLElement;
  const v = EditorView.findFromDOM(el);
  if (!v) throw new Error('no editor view');
  return v;
}

const typeAtEnd = (text: string) =>
  act(() => {
    const v = view();
    v.dispatch({ changes: { from: v.state.doc.length, insert: text } });
  });

const toasts = () => useShell.getState().toasts.map((t) => t.text);
const header = () => document.querySelector('.app-header') as HTMLElement;

let store: FakeServerStore;

beforeEach(() => {
  localStorage.clear();
  useShell.setState({ toasts: [] });
  useWorkspace.setState({ intent: null, recentFiles: [], summaries: {} });
  store = new FakeServerStore({
    'README.md': '# Real project\n',
    'src/main.py': 'print("hi")\n',
  });
  services.store = store;
  services.connection.mode = 'host';
});

afterEach(() => {
  cleanup();
});

/* ------------------------------------------------------------------ tests */

describe('EditorApp on the Linux machine (server store)', () => {
  it('labels itself honestly and opens README.md on first launch', async () => {
    renderEditor();
    await waitFor(() => expect(within(header()).getByRole('heading', { name: 'README.md' })).toBeTruthy());
    expect(within(header()).queryByText('Local files')).toBeNull();
    expect(within(header()).getByText('Linux machine')).toBeTruthy();
    expect(screen.getAllByText('Saved on your Linux machine').length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/Saved in this browser/);
    expect(screen.getByText('my-project')).toBeTruthy(); // root name from the server
    expect(view().state.doc.toString()).toBe('# Real project\n');
  });

  it('shows a list error with Retry, then recovers (and still opens README.md)', async () => {
    store.failList = 1;
    renderEditor();
    const alerts = await screen.findAllByText(/Could not reach the Linux machine/);
    expect(alerts.length).toBeGreaterThan(0);
    expect(screen.queryByText(/no files yet/)).toBeNull(); // a failure is not an empty project
    fireEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0]);
    await waitFor(() => expect(within(header()).getByRole('heading', { name: 'README.md' })).toBeTruthy());
    expect(screen.queryByText(/Could not reach the Linux machine/)).toBeNull();
  });

  it('shows "Couldn’t open" with Retry when a read fails', async () => {
    store.failRead.set('src/main.py', 1);
    renderEditor();
    await waitFor(() => expect(within(header()).getByRole('heading', { name: 'README.md' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /^main\.py/ }));
    await screen.findByText(/Couldn’t open main\.py/);
    expect(screen.getByText('Request failed (502)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(within(header()).getByRole('heading', { name: 'main.py' })).toBeTruthy());
    expect(screen.queryByText(/Couldn’t open/)).toBeNull();
  });

  it('saves to the machine with an honest toast; failed saves keep the buffer and offer Try again', async () => {
    renderEditor();
    await waitFor(() => expect(within(header()).getByRole('heading', { name: 'README.md' })).toBeTruthy());
    typeAtEnd('more\n');
    await waitFor(() => expect(within(header()).getByText(/README\.md • Edited/)).toBeTruthy());
    expect(useWorkspace.getState().summaries.editor).toMatch(/unsaved/);

    store.failWrite = 1;
    fireEvent.keyDown(window, { key: 's', metaKey: true });
    await screen.findByText(/Couldn’t save README\.md/);
    expect(view().state.doc.toString()).toBe('# Real project\nmore\n');
    expect(useWorkspace.getState().summaries.editor).toMatch(/unsaved/);

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(toasts()).toContain('Saved README.md on your Linux machine'));
    expect(store.files.get('README.md')!.content).toBe('# Real project\nmore\n');
    await waitFor(() => expect(useWorkspace.getState().summaries.editor).not.toMatch(/unsaved/));
  });

  it('reloads clean tabs silently and warns on dirty ones; deletion keeps the buffer', async () => {
    renderEditor();
    await waitFor(() => expect(within(header()).getByRole('heading', { name: 'README.md' })).toBeTruthy());

    await act(async () => store.external('README.md', '# Changed by the terminal\n'));
    await waitFor(() => expect(view().state.doc.toString()).toBe('# Changed by the terminal\n'));
    expect(screen.queryByText(/changed elsewhere/)).toBeNull();

    typeAtEnd('mine\n');
    await act(async () => store.external('README.md', '# Changed again\n'));
    await screen.findByText('This file changed elsewhere');
    expect(view().state.doc.toString()).toBe('# Changed by the terminal\nmine\n');
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    await waitFor(() => expect(view().state.doc.toString()).toBe('# Changed again\n'));

    await act(async () => store.external('README.md', null));
    await screen.findByText('This file was deleted elsewhere');
    expect(view().state.doc.toString()).toBe('# Changed again\n');
    expect(useWorkspace.getState().summaries.editor).toMatch(/unsaved/);
  });

  it('does not download unchanged open files again on every refresh', async () => {
    renderEditor();
    await waitFor(() => expect(within(header()).getByRole('heading', { name: 'README.md' })).toBeTruthy());
    await act(async () => store.external('src/other.py', 'x'));
    await act(async () => store.external('src/other2.py', 'y'));
    await waitFor(() => expect(screen.getByRole('button', { name: /^other2\.py/ })).toBeTruthy());
    // One read to open, at most one to confirm after the first change; none after that.
    expect(store.reads.filter((p) => p === 'README.md').length).toBeLessThanOrEqual(2);
  });

  it('remembers tabs under the host key only', async () => {
    renderEditor();
    await waitFor(() => expect(within(header()).getByRole('heading', { name: 'README.md' })).toBeTruthy());
    await waitFor(() => expect(localStorage.getItem('orbit:editor:v1:host')).toContain('README.md'));
    expect(localStorage.getItem('orbit:editor:v1:demo')).toBeNull();
  });

  it('opens files requested by other apps', async () => {
    renderEditor();
    await waitFor(() => expect(within(header()).getByRole('heading', { name: 'README.md' })).toBeTruthy());
    act(() => useWorkspace.getState().sendIntent({ app: 'editor', type: 'open-file', path: 'src/main.py' }));
    await waitFor(() => expect(within(header()).getByRole('heading', { name: 'main.py' })).toBeTruthy());
    expect(useWorkspace.getState().intent).toBeNull();
    expect(useWorkspace.getState().recentFiles[0].path).toBe('src/main.py');
  });

  it('asks Antigravity about the current file', async () => {
    renderEditor();
    await waitFor(() => expect(within(header()).getByRole('heading', { name: 'README.md' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Ask Antigravity about this file' }));
    expect(useWorkspace.getState().intent).toMatchObject({ app: 'agent', type: 'compose', text: 'About `README.md`: ' });
    expect(useShell.getState().activeApp).toBe('agent');
  });

  it('collapses folders of big projects and filters files', async () => {
    for (let i = 0; i < 250; i++) store.files.set(`pkg${i % 5}/file${i}.ts`, { content: '', updatedAt: 1 });
    renderEditor();
    await waitFor(() => expect(within(header()).getByRole('heading', { name: 'README.md' })).toBeTruthy());
    const tree = screen.getByRole('list', { name: 'Files in my-project' });
    expect(within(tree).queryByText('file0.ts')).toBeNull(); // collapsed by default
    expect(within(tree).getByRole('button', { name: 'pkg0' }).getAttribute('aria-expanded')).toBe('false');

    fireEvent.change(screen.getByLabelText('Filter files'), { target: { value: 'file24' } });
    const results = screen.getByRole('list', { name: 'Files matching file24' });
    expect(within(results).getAllByRole('button', { name: /file24/ }).length).toBeGreaterThan(0);
    fireEvent.keyDown(screen.getByLabelText('Filter files'), { key: 'Enter' });
    await waitFor(() => expect(within(header()).getByRole('heading', { name: 'file24.ts' })).toBeTruthy());
  });
});

describe('EditorApp in demo mode', () => {
  it('shows the Local files demo chip and uses the demo key', async () => {
    services.connection.mode = 'demo';
    renderEditor();
    await waitFor(() => expect(within(header()).getByRole('heading', { name: 'README.md' })).toBeTruthy());
    expect(within(header()).getByText('Local files')).toBeTruthy();
    await waitFor(() => expect(localStorage.getItem('orbit:editor:v1:demo')).toContain('README.md'));
    expect(localStorage.getItem('orbit:editor:v1:host')).toBeNull();
  });
});
