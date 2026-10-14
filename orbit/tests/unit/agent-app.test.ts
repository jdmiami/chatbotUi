/**
 * AgentApp against both runners:
 *  - demo mode: the real DemoRunner (canned replies, in-memory storage);
 *  - host mode: a fake HostRunner-like adapter with watch() and stopSession(), for turns started
 *    elsewhere, sign-in errors, model-list errors and load failures with Retry.
 */
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DemoRunner } from '../../src/services/runner/demo/DemoRunner';
import { STOP_NOTICE } from '../../src/services/runner/demo/fixtures';
import { AGY_CAPABILITIES } from '../../src/services/runner/agyCapabilities';
import type {
  ModelOption,
  Project,
  RunHandle,
  RunnerAdapter,
  RunnerMode,
  SendHandlers,
  SessionSummary,
  TranscriptItem,
} from '../../src/services/runner/types';

/* ------------------------------------------------------------------ fakes */

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  clear() {
    this.data.clear();
  }
  getItem(key: string) {
    return this.data.get(key) ?? null;
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

type WatchHandlers = Pick<SendHandlers, 'onItem' | 'onUpdate' | 'onDone'>;
interface WatchCall {
  id: string;
  handlers: WatchHandlers;
  signal?: AbortSignal;
  resolve: () => void;
  reject: (e: Error) => void;
}

/** Stand-in for HostRunner: sessions "on the machine", controllable watch() and stopSession(). */
class FakeHostRunner implements RunnerAdapter {
  readonly kind = 'antigravity-cli' as const;
  readonly label = 'Antigravity CLI on your Linux machine';
  capabilities = AGY_CAPABILITIES;
  projects: Project[] = [{ id: 'proj', name: 'my-project', path: '/home/me/my-project' }];
  sessions: SessionSummary[];
  transcripts: Record<string, TranscriptItem[]>;
  failProjects = 0;
  modelsError: Error | null = null;
  sendError: Error | null = null;
  watchCalls: WatchCall[] = [];
  stopCalls: string[] = [];
  sent: { id: string; text: string }[] = [];
  private listeners = new Set<() => void>();

  constructor() {
    const base = { projectId: 'proj', createdAt: 1_000, mode: 'default' as RunnerMode, simulated: false };
    this.sessions = [
      { ...base, id: 's-run', title: 'Refactor the parser', updatedAt: Date.now(), status: 'running', conversationId: 'c-1', messageCount: 3 },
      { ...base, id: 's-idle', title: 'Write release notes', updatedAt: Date.now() - 60_000, status: 'idle', messageCount: 0 },
    ];
    this.transcripts = {
      's-run': [
        { kind: 'user', id: 'u1', at: 1, text: 'Refactor the parser' },
        { kind: 'assistant', id: 'r1', at: 2, text: 'Done. See `parser.ts`.' },
        { kind: 'user', id: 'u2', at: 3, text: 'Now add tests' },
      ],
      's-idle': [],
    };
  }

  async listProjects() {
    if (this.failProjects > 0) {
      this.failProjects--;
      throw new Error('Could not reach the Linux machine. Check that it is on.');
    }
    return this.projects;
  }
  async listSessions(projectId: string) {
    return this.sessions.filter((s) => s.projectId === projectId).map((s) => ({ ...s }));
  }
  async getSession(id: string) {
    const s = this.sessions.find((x) => x.id === id);
    return s ? { ...s } : undefined;
  }
  async getTranscript(id: string) {
    return [...(this.transcripts[id] ?? [])];
  }
  async createSession(projectId: string, opts: { title?: string; model?: string; mode?: RunnerMode } = {}) {
    const s: SessionSummary = {
      id: `s-${this.sessions.length + 1}`,
      projectId,
      title: opts.title || 'New session',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: 'idle',
      mode: opts.mode ?? 'default',
      model: opts.model,
      messageCount: 0,
      simulated: false,
    };
    this.sessions.push(s);
    this.transcripts[s.id] = [];
    return { ...s };
  }
  async updateSession(id: string, patch: Partial<Pick<SessionSummary, 'title' | 'model' | 'mode'>>) {
    const s = this.sessions.find((x) => x.id === id)!;
    Object.assign(s, patch, { updatedAt: Date.now() });
    return { ...s };
  }
  async deleteSession(id: string) {
    this.sessions = this.sessions.filter((s) => s.id !== id);
  }
  async listModels(): Promise<ModelOption[]> {
    if (this.modelsError) throw this.modelsError;
    return [{ id: 'model-a', label: 'Model A' }];
  }
  send(id: string, text: string, handlers: SendHandlers): RunHandle {
    this.sent.push({ id, text });
    const err = this.sendError;
    setTimeout(() => {
      if (err) handlers.onError(err);
    }, 0);
    return { stop() {} };
  }
  watch(id: string, handlers: WatchHandlers, signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.watchCalls.push({ id, handlers, signal, resolve, reject });
      signal?.addEventListener('abort', () => resolve(), { once: true });
    });
  }
  async stopSession(id: string) {
    this.stopCalls.push(id);
    const s = this.sessions.find((x) => x.id === id);
    if (s) s.status = 'stopped';
    return { stopped: true };
  }
  subscribe(l: () => void) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  reset() {}
}

/* ------------------------------------------------------------------ module mocks */

const services = vi.hoisted(() => ({
  runner: null as unknown as RunnerAdapter,
  connection: { mode: 'demo' as 'demo' | 'host', label: 'Demo mode', detail: '' },
}));

vi.mock('../../src/services', () => ({
  get connection() {
    return services.connection;
  },
  getRunner: () => services.runner,
}));

const { default: AgentApp } = await import('../../src/apps/agent/AgentApp');
const { useShell } = await import('../../src/state/shell');
const { useWorkspace } = await import('../../src/state/workspace');

/* ------------------------------------------------------------------ helpers */

function renderAgent(compact = false) {
  return render(createElement(AgentApp, { placement: 'full', isActive: true, compact }));
}
const header = () => document.querySelector('.app-header') as HTMLElement;
const composer = () => screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement;
const summary = () => useWorkspace.getState().summaries.agent ?? '';
const typeDraft = (text: string) => fireEvent.change(composer(), { target: { value: text } });
const sidebar = () => screen.getByRole('complementary', { name: 'Projects and sessions' });
const sessionButton = (title: RegExp) => within(sidebar()).getByRole('button', { name: title });

beforeEach(() => {
  localStorage.clear();
  useShell.setState({ toasts: [], activeApp: 'agent', openApps: ['agent'] });
  useWorkspace.setState({ intent: null, recentSessions: [], summaries: {} });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ demo mode */

describe('AgentApp in demo mode (DemoRunner)', () => {
  let runner: DemoRunner;
  beforeEach(() => {
    runner = new DemoRunner({ storage: new MemoryStorage() });
    services.runner = runner;
    services.connection.mode = 'demo';
  });

  it('two columns: labels itself as simulated and opens the most recent session', async () => {
    renderAgent();
    await waitFor(() => expect(within(header()).getByRole('heading', { name: 'Explain the project layout' })).toBeTruthy());
    expect(within(header()).getByText('Simulated')).toBeTruthy();
    expect(within(header()).getByText(/orbit-demo · Ready/)).toBeTruthy();
    expect(within(header()).queryByText('Linux machine')).toBeNull();
    expect(within(sidebar()).getAllByText('Resumable').length).toBeGreaterThan(0);
    await screen.findAllByText('Simulated reply');
    // Fenced code renders as <pre> with its own Copy button; replies have Copy too.
    expect(document.querySelector('pre.ag-code-body')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Copy reply' }).length).toBeGreaterThan(0);
    expect(useWorkspace.getState().recentSessions[0]).toMatchObject({ id: 'demo-ses-layout', projectName: 'orbit-demo' });
  });

  it('Send is disabled when empty; a turn shows Stop and a disabled Pause, then the whole reply', async () => {
    renderAgent();
    await screen.findAllByText('Simulated reply');
    const send = screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    typeDraft('What does src/app.py do?');
    expect(send.disabled).toBe(false);
    fireEvent.click(send);

    expect(await screen.findByText('What does src/app.py do?')).toBeTruthy();
    expect(composer().value).toBe('');
    const stop = screen.getByRole('button', { name: 'Stop' }) as HTMLButtonElement;
    expect(stop.disabled).toBe(false);
    const pause = screen.getByRole('button', { name: /Pause/ }) as HTMLButtonElement;
    expect(pause.disabled).toBe(true);
    expect(screen.getByText(/Pause isn’t available/)).toBeTruthy();
    expect(summary()).toBe('Explain the project layout — running');

    await screen.findByText(/can't open/, undefined, { timeout: 4000 }); // ~1.2–2 s simulated delay
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    expect(within(header()).getByText(/orbit-demo · Ready/)).toBeTruthy();
    expect(summary()).toBe('2 sessions');
  });

  it('Stop cancels the turn with the stop notice', async () => {
    renderAgent();
    await screen.findAllByText('Simulated reply');
    typeDraft('Plan a refactor');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Stop' }));
    expect(await screen.findByText(STOP_NOTICE)).toBeTruthy();
    expect(within(header()).getByText(/· Stopped/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  });

  it('keeps a draft per session across session switches and reports it as unsaved', async () => {
    renderAgent();
    await screen.findAllByText('Simulated reply');
    typeDraft('half-written question');
    await waitFor(() => expect(summary()).toMatch(/draft not sent.*unsaved/));

    fireEvent.click(sessionButton(/^Plan: add a \/health endpoint/));
    await waitFor(() => expect(within(header()).getByRole('heading', { name: 'Plan: add a /health endpoint' })).toBeTruthy());
    expect(composer().value).toBe('');
    expect(summary()).toMatch(/1 unsaved draft/);
    expect(within(sidebar()).getByText('Draft')).toBeTruthy();

    fireEvent.click(sessionButton(/^Explain the project layout/));
    await waitFor(() => expect(composer().value).toBe('half-written question'));
  });

  it('phones: stacked list → conversation with a visible Back button', async () => {
    renderAgent(true);
    const open = await screen.findByRole('button', { name: /^Explain the project layout/ });
    expect(screen.queryByRole('textbox', { name: 'Message' })).toBeNull();
    fireEvent.click(open);
    expect(await screen.findByRole('button', { name: 'Back to sessions' })).toBeTruthy();
    expect(composer()).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back to sessions' }));
    expect(await screen.findByRole('complementary', { name: 'Projects and sessions' })).toBeTruthy();
    expect(within(header()).getByRole('heading', { name: 'Antigravity' })).toBeTruthy();
  });

  it('empty project: "Start a session"; New session creates one and focuses the composer', async () => {
    renderAgent();
    await screen.findAllByText('Simulated reply');
    fireEvent.change(within(sidebar()).getByLabelText('Project'), { target: { value: 'dotfiles' } });
    expect((await screen.findAllByText('Start a session')).length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByRole('button', { name: 'New session' })[0]);
    const dialog = await screen.findByRole('dialog', { name: 'New session' });
    expect(within(dialog).getByText(/Starts a new Antigravity conversation/)).toBeTruthy();
    expect(within(dialog).getByText(/Sample list; the real list comes from/)).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'Tidy my dotfiles' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create session' }));

    await waitFor(() => expect(within(header()).getByRole('heading', { name: 'Tidy my dotfiles' })).toBeTruthy());
    expect(within(header()).getByText(/dotfiles · New/)).toBeTruthy();
    expect(await screen.findByText('Start the conversation')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(composer()));
  });

  it('renames, shows session info and deletes (with confirmation)', async () => {
    useWorkspace.getState().noteSession({ id: 'demo-ses-health', title: 'Plan: add a /health endpoint', projectName: 'orbit-demo' });
    renderAgent();
    await screen.findAllByText('Simulated reply');
    fireEvent.click(within(sidebar()).getByRole('button', { name: /Session info and actions for Plan/ }));
    const info = await screen.findByRole('dialog', { name: 'Session info' });
    expect(within(info).getByText('demo-b81d07c3')).toBeTruthy();
    expect(within(info).getByText(/Follow-ups continue it with/)).toBeTruthy();

    fireEvent.click(within(info).getByRole('button', { name: 'Rename' }));
    const rename = await screen.findByRole('dialog', { name: 'Rename session' });
    fireEvent.change(within(rename).getByLabelText('Title'), { target: { value: 'Health check plan' } });
    fireEvent.click(within(rename).getByRole('button', { name: 'Rename' }));
    await waitFor(() => expect(sessionButton(/^Health check plan/)).toBeTruthy());

    fireEvent.click(within(sidebar()).getByRole('button', { name: /Session info and actions for Health check plan/ }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Session info' })).getByRole('button', { name: 'Delete' }));
    const confirm = await screen.findByRole('dialog', { name: 'Delete session?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(within(sidebar()).queryByRole('button', { name: /^Health check plan/ })).toBeNull());
    expect(await runner.getSession('demo-ses-health')).toBeUndefined();
    expect(useWorkspace.getState().recentSessions.some((r) => r.id === 'demo-ses-health')).toBe(false);
  });

  it('"What\'s supported" lists supported, unsupported and unverified features', async () => {
    renderAgent();
    await screen.findAllByText('Simulated reply');
    fireEvent.click(within(header()).getByRole('button', { name: "What's supported" }));
    const sheet = await screen.findByRole('dialog', { name: "What's supported" });
    expect(within(sheet).getByText('Demo runner — simulated replies, Antigravity CLI not called')).toBeTruthy();
    expect(within(sheet).getByRole('heading', { name: 'Not supported' })).toBeTruthy();
    expect(within(sheet).getByText('Pause and resume a turn')).toBeTruthy();
    expect(within(sheet).getByRole('heading', { name: 'Not verified yet' })).toBeTruthy();
    expect(within(sheet).getByText('Live streaming of replies')).toBeTruthy();
  });

  it('compose intent: drafts into the conversation that is open (e.g. Code + Chat side by side)', async () => {
    renderAgent();
    await screen.findAllByText('Simulated reply');
    fireEvent.click(sessionButton(/^Plan: add a \/health endpoint/));
    act(() => useWorkspace.getState().sendIntent({ app: 'agent', type: 'compose', text: 'Explain this selection' }));
    await waitFor(() => expect(composer().value).toBe('Explain this selection'));
    expect(within(header()).getByRole('heading', { name: /Plan: add a \/health endpoint/ })).toBeTruthy();
    expect(useWorkspace.getState().intent).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(composer()));
  });

  it('compose intent with nothing open: latest session of the file’s project', async () => {
    renderAgent();
    await screen.findAllByText('Simulated reply');
    act(() =>
      useWorkspace.getState().sendIntent({ app: 'agent', type: 'compose', text: 'About `src/app.py`: ', path: 'src/app.py' }),
    );
    await waitFor(() => expect(composer().value).toBe('About `src/app.py`: '));
    expect(within(header()).getByRole('heading', { name: 'Explain the project layout' })).toBeTruthy();
  });

  it('compose intent never creates an empty session: it offers New session, pre-filled', async () => {
    for (const s of await runner.listSessions('orbit-demo')) await runner.deleteSession(s.id);
    renderAgent();
    act(() =>
      useWorkspace.getState().sendIntent({ app: 'agent', type: 'compose', text: 'About `README.md`: ', path: 'README.md' }),
    );
    const sheet = await screen.findByRole('dialog', { name: 'New session' });
    expect((within(sheet).getByRole('textbox', { name: /title/i }) as HTMLInputElement).value).toBe('README.md');
    expect(await runner.listSessions('orbit-demo')).toEqual([]);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Create session' }));
    await waitFor(() => expect(within(header()).getByRole('heading', { name: 'README.md' })).toBeTruthy());
    expect(composer().value).toBe('About `README.md`: ');
  });

  it('open-session intent switches project and opens it; unknown ids are forgotten', async () => {
    useWorkspace.getState().noteSession({ id: 'gone', title: 'Old', projectName: 'x' });
    renderAgent(true);
    act(() => useWorkspace.getState().sendIntent({ app: 'agent', type: 'open-session', sessionId: 'demo-ses-auth' }));
    await waitFor(() => expect(within(header()).getByRole('heading', { name: 'Explain the auth middleware' })).toBeTruthy());
    expect(within(header()).getByText(/api-service/)).toBeTruthy();

    act(() => useWorkspace.getState().sendIntent({ app: 'agent', type: 'open-session', sessionId: 'gone' }));
    await waitFor(() => expect(useWorkspace.getState().recentSessions.some((r) => r.id === 'gone')).toBe(false));
  });
});

/* ------------------------------------------------------------------ host mode */

describe('AgentApp on the Linux machine (host runner)', () => {
  let runner: FakeHostRunner;
  beforeEach(() => {
    runner = new FakeHostRunner();
    services.runner = runner;
    services.connection.mode = 'host';
  });

  it('labels itself honestly: no demo chip, no "Simulated reply" tags', async () => {
    renderAgent();
    await waitFor(() => expect(within(header()).getByRole('heading', { name: 'Refactor the parser' })).toBeTruthy());
    expect(within(header()).getByText('Linux machine')).toBeTruthy();
    expect(within(header()).queryByText('Simulated')).toBeNull();
    await screen.findByText(/Done\. See/);
    expect(screen.queryByText('Simulated reply')).toBeNull();
  });

  it('follows a turn started elsewhere with watch(), and Stop ends it via stopSession()', async () => {
    renderAgent();
    await waitFor(() => expect(runner.watchCalls).toHaveLength(1));
    const call = runner.watchCalls[0];
    expect(call.id).toBe('s-run');
    act(() => call.handlers.onItem({ kind: 'activity', id: 'a9', at: 4, title: 'Reading parser.ts', status: 'running' }));
    expect(await screen.findByText('Reading parser.ts')).toBeTruthy();

    const stop = screen.getByRole('button', { name: 'Stop' }) as HTMLButtonElement;
    expect(stop.disabled).toBe(false);
    fireEvent.click(stop);
    await waitFor(() => expect(runner.stopCalls).toEqual(['s-run']));
    expect((screen.getByRole('button', { name: 'Stopping' }) as HTMLButtonElement).disabled).toBe(true);

    // The machine reports the end of the turn on the watch stream.
    runner.transcripts['s-run'].push({ kind: 'notice', id: 'n1', at: 5, text: 'Stopped by you.', tone: 'warning' });
    act(() => {
      call.handlers.onDone({ ...runner.sessions[0], status: 'stopped' });
      call.resolve();
    });
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Stop(ping)?$/ })).toBeNull());
    expect(within(header()).getByText(/my-project · Stopped/)).toBeTruthy();
    expect(await screen.findByText('Stopped by you.')).toBeTruthy();
  });

  it('leaving the conversation aborts the watch', async () => {
    renderAgent();
    await waitFor(() => expect(runner.watchCalls).toHaveLength(1));
    fireEvent.click(sessionButton(/^Write release notes/));
    await waitFor(() => expect(runner.watchCalls[0].signal?.aborted).toBe(true));
  });

  it('a lost watch shows Retry, and Stop still works (then reads the final state)', async () => {
    renderAgent();
    await waitFor(() => expect(runner.watchCalls).toHaveLength(1));
    act(() => runner.watchCalls[0].reject(new Error('Lost the connection to the Linux machine.')));
    expect(await screen.findByText('Lost track of the running turn')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(runner.stopCalls).toEqual(['s-run']));
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Stop(ping)?$/ })).toBeNull());
    expect(within(header()).getByText(/my-project · Stopped/)).toBeTruthy();
  });

  it('a reply that fails because agy is not signed in keeps the text and shows the sign-in hint', async () => {
    runner.sendError = new Error('agy is not signed in. Run `agy` to authenticate.');
    renderAgent();
    await screen.findByText(/Done\. See/);
    fireEvent.click(sessionButton(/^Write release notes/));
    await screen.findByText('Start the conversation');
    typeDraft('Draft the notes');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Message not sent')).toBeTruthy();
    expect(screen.getByText(/Open Terminal and run/)).toBeTruthy();
    expect(composer().value).toBe('Draft the notes');
    expect(runner.sent).toEqual([{ id: 's-idle', text: 'Draft the notes' }]);

    // Retry sends it again.
    runner.sendError = null;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(runner.sent).toHaveLength(2));
    expect(screen.queryByText('Message not sent')).toBeNull();
  });

  it('a model-list error is a gentle inline note, not a crash', async () => {
    runner.modelsError = new Error('Not signed in');
    renderAgent();
    expect(await screen.findByText(/Models need a signed-in agy/)).toBeTruthy();
    expect((screen.getByLabelText('Model') as HTMLSelectElement).disabled).toBe(false);
    runner.modelsError = null;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryByText(/Models need a signed-in agy/)).toBeNull());
    expect(screen.getByRole('option', { name: 'Model A' })).toBeTruthy();
  });

  it('a project-list failure shows an error with Retry, then recovers', async () => {
    runner.failProjects = 1;
    renderAgent();
    expect(await screen.findByText('Couldn’t load projects')).toBeTruthy();
    expect(screen.getByText(/Could not reach the Linux machine/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(within(header()).getByRole('heading', { name: 'Refactor the parser' })).toBeTruthy());
  });

  it('summary says which session is running', async () => {
    renderAgent();
    await waitFor(() => expect(summary()).toBe('Refactor the parser — running'));
  });
});
