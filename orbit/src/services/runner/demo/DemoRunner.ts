import { AGY_CAPABILITIES } from '../agyCapabilities';
import type {
  ModelOption,
  Project,
  RunHandle,
  RunnerAdapter,
  RunnerCapabilities,
  RunnerMode,
  SendHandlers,
  SessionSummary,
  TranscriptItem,
} from '../types';
import {
  DEMO_MODELS,
  DEMO_MODELS_NOTE,
  DEMO_RUNNER_KEY,
  DEMO_RUNNER_LABEL,
  STOP_NOTICE,
  WORKING_TITLE,
  agyCommand,
  buildSeed,
  cannedReply,
  simulatedDetail,
  type DemoData,
} from './fixtures';

type AssistantItem = Extract<TranscriptItem, { kind: 'assistant' }>;

const MODES: ReadonlySet<RunnerMode> = new Set<RunnerMode>(['default', 'plan', 'accept-edits']);

/** One in-flight simulated turn. */
interface Pending {
  timers: Set<ReturnType<typeof setTimeout>>;
  handlers: SendHandlers;
  activityId: string;
  assistantId?: string;
}

export interface DemoRunnerOptions {
  /** Defaults to window.localStorage; null (or unavailable storage) keeps data in memory only. */
  storage?: Storage | null;
  /** Defaults to AGY_CAPABILITIES, the same list the real runner reports. */
  capabilities?: RunnerCapabilities;
}

/**
 * All DemoRunner instances on this page. Settings → "Reset demo data" uses its own instance, so
 * the instance the Antigravity app holds must hear about it (storage events only reach other tabs).
 */
const instances = new Set<DemoRunner>();

function defaultStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null; // storage blocked (e.g. some private-browsing modes)
  }
}

const rid = () => Math.random().toString(16).slice(2, 10).padEnd(8, '0');

function copySession(s: SessionSummary): SessionSummary {
  return { ...s };
}
function copyItem(i: TranscriptItem): TranscriptItem {
  return { ...i };
}

function isDemoData(v: unknown): v is DemoData {
  const d = v as DemoData | null;
  return (
    !!d &&
    d.version === 1 &&
    Array.isArray(d.projects) &&
    Array.isArray(d.sessions) &&
    typeof d.transcripts === 'object' &&
    d.transcripts !== null
  );
}

/**
 * Demo runner (demo mode only): sample projects and sessions stored in this browser, and canned,
 * clearly labelled replies. The Antigravity CLI is never called.
 *
 * It reports the real CLI's capabilities (AGY_CAPABILITIES) so the UI shows exactly the controls
 * the real runner has. Because `streamOutput` is not verified for agy, replies arrive whole after
 * a short delay; the token-by-token path is only used if a capability list says streaming works.
 */
export class DemoRunner implements RunnerAdapter {
  readonly kind = 'demo' as const;
  readonly label = DEMO_RUNNER_LABEL;
  readonly capabilities: RunnerCapabilities;
  /** Shown with the model list: the demo list is a sample. */
  readonly modelsNote = DEMO_MODELS_NOTE;

  private readonly storage: Storage | null;
  private data: DemoData;
  private lastRaw: string | null = null;
  private listeners = new Set<() => void>();
  private pending = new Map<string, Pending>();
  private onStorage = (e: StorageEvent) => {
    if (e.key === DEMO_RUNNER_KEY) this.sync(true);
  };

  constructor(opts: DemoRunnerOptions = {}) {
    this.storage = opts.storage === undefined ? defaultStorage() : opts.storage;
    this.capabilities = opts.capabilities ?? AGY_CAPABILITIES;
    this.data = this.load(true);
  }

  /* ------------------------------------------------------------------ storage */

  private readRaw(): string | null {
    try {
      return this.storage?.getItem(DEMO_RUNNER_KEY) ?? null;
    } catch {
      return null;
    }
  }

  private load(initial: boolean): DemoData {
    const raw = this.readRaw();
    let data: DemoData | null = null;
    if (raw) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (isDemoData(parsed)) data = parsed;
      } catch {
        data = null; // corrupted: fall back to the seed
      }
    }
    if (!data) {
      data = buildSeed(Date.now());
      this.lastRaw = null;
      this.persist(data);
      return data;
    }
    this.lastRaw = raw;
    if (initial) {
      // A turn that was in flight when the page closed can't continue: no timer survives a reload.
      for (const s of data.sessions) {
        if (s.status !== 'running') continue;
        s.status = 'stopped';
        const items = (data.transcripts[s.id] ??= []);
        for (const it of items) if (it.kind === 'activity' && it.status === 'running') it.status = 'failed';
        items.push({
          kind: 'notice',
          id: `demo-itm-${rid()}`,
          at: Date.now(),
          text: 'This simulated turn was interrupted when the page was closed or reloaded.',
          tone: 'warning',
        });
      }
    }
    return data;
  }

  private persist(data: DemoData = this.data) {
    if (!this.storage) return;
    try {
      const raw = JSON.stringify(data);
      this.storage.setItem(DEMO_RUNNER_KEY, raw);
      this.lastRaw = raw;
    } catch {
      // Storage full or blocked: keep working in memory for this visit.
    }
  }

  /** Pick up changes another instance (or tab) wrote. Returns true if anything changed. */
  private sync(notify = false): boolean {
    if (!this.storage) return false;
    const raw = this.readRaw();
    if (raw === this.lastRaw) return false;
    this.data = this.load(false);
    // Turns whose session vanished (e.g. demo data was reset) can't finish.
    for (const [id, p] of [...this.pending]) {
      if (!this.data.sessions.some((s) => s.id === id)) {
        this.cancelTimers(id);
        p.handlers.onError(new Error('The demo data was reset, so this simulated turn ended.'));
      }
    }
    if (notify) this.emitLocal();
    return true;
  }

  /** Commit a change: save, then notify this instance's listeners and the other instances. */
  private commit() {
    this.persist();
    this.emitLocal();
    for (const other of instances) if (other !== this) other.sync(true);
  }

  private emitLocal() {
    this.listeners.forEach((l) => l());
  }

  /* ------------------------------------------------------------------ queries */

  private findSession(id: string): SessionSummary | undefined {
    return this.data.sessions.find((s) => s.id === id);
  }

  private requireSession(id: string): SessionSummary {
    const s = this.findSession(id);
    if (!s) throw new Error('Unknown session.');
    return s;
  }

  async listProjects(): Promise<Project[]> {
    this.sync();
    return this.data.projects.map((p) => ({ ...p }));
  }

  async listSessions(projectId: string): Promise<SessionSummary[]> {
    this.sync();
    return this.data.sessions
      .filter((s) => s.projectId === projectId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(copySession);
  }

  async getSession(sessionId: string): Promise<SessionSummary | undefined> {
    this.sync();
    const s = this.findSession(sessionId);
    return s ? copySession(s) : undefined;
  }

  async getTranscript(sessionId: string): Promise<TranscriptItem[]> {
    this.sync();
    this.requireSession(sessionId);
    return (this.data.transcripts[sessionId] ?? []).map(copyItem);
  }

  async listModels(): Promise<ModelOption[]> {
    return DEMO_MODELS.map((m) => ({ ...m }));
  }

  /* ------------------------------------------------------------------ session management */

  async createSession(
    projectId: string,
    opts: { title?: string; model?: string; mode?: RunnerMode } = {},
  ): Promise<SessionSummary> {
    this.sync();
    if (!this.data.projects.some((p) => p.id === projectId)) throw new Error('Unknown project.');
    const mode = opts.mode ?? 'default';
    if (!MODES.has(mode)) throw new Error('Unknown mode.');
    const now = Date.now();
    const s: SessionSummary = {
      id: `demo-ses-${rid()}${rid()}`,
      projectId,
      title: (opts.title ?? '').trim().slice(0, 120) || 'New session',
      createdAt: now,
      updatedAt: now,
      status: 'idle',
      mode,
      model: opts.model || undefined,
      messageCount: 0,
      simulated: true,
    };
    this.data.sessions.push(s);
    this.data.transcripts[s.id] = [];
    this.commit();
    return copySession(s);
  }

  async updateSession(
    sessionId: string,
    patch: Partial<Pick<SessionSummary, 'title' | 'model' | 'mode'>>,
  ): Promise<SessionSummary> {
    this.sync();
    const s = this.requireSession(sessionId);
    if (patch.mode !== undefined && !MODES.has(patch.mode)) throw new Error('Unknown mode.');
    if (patch.title !== undefined) s.title = String(patch.title).trim().slice(0, 120) || s.title;
    if ('model' in patch) s.model = patch.model || undefined;
    if (patch.mode !== undefined) s.mode = patch.mode;
    s.updatedAt = Date.now();
    this.commit();
    return copySession(s);
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.sync();
    this.requireSession(sessionId);
    this.cancelTimers(sessionId);
    this.data.sessions = this.data.sessions.filter((s) => s.id !== sessionId);
    delete this.data.transcripts[sessionId];
    this.commit();
  }

  /* ------------------------------------------------------------------ turns */

  send(sessionId: string, text: string, handlers: SendHandlers): RunHandle {
    this.sync();
    const noop: RunHandle = { stop() {} };
    const s = this.findSession(sessionId);
    const prompt = String(text ?? '').trim();
    if (!s) {
      handlers.onError(new Error('Unknown session.'));
      return noop;
    }
    if (!prompt) {
      handlers.onError(new Error('Message is empty.'));
      return noop;
    }
    if (s.status === 'running' || this.pending.has(sessionId)) {
      handlers.onError(new Error('This session is already running a turn. Stop it or wait for it to finish.'));
      return noop;
    }

    const items = (this.data.transcripts[sessionId] ??= []);
    const now = Date.now();
    const user: TranscriptItem = { kind: 'user', id: `demo-itm-${rid()}`, at: now, text: prompt };
    const activity: TranscriptItem = {
      kind: 'activity',
      id: `demo-itm-${rid()}`,
      at: now,
      title: WORKING_TITLE,
      detail: simulatedDetail(agyCommand({ conversationId: s.conversationId, mode: s.mode, model: s.model })),
      status: 'running',
    };
    items.push(user, activity);
    s.status = 'running';
    s.updatedAt = now;
    s.messageCount += 1;

    const pending: Pending = { timers: new Set(), handlers, activityId: activity.id };
    this.pending.set(sessionId, pending);
    this.commit();
    handlers.onItem(copyItem(user));
    handlers.onItem(copyItem(activity));

    const reply = cannedReply(prompt);
    const delay = 1200 + Math.round(Math.random() * 800);
    if (this.capabilities.streamOutput.status === 'supported') this.streamReply(sessionId, reply, delay);
    else this.later(sessionId, delay, () => this.finishTurn(sessionId, reply));

    return { stop: () => this.stopTurn(sessionId) };
  }

  /** Run `fn` after `ms` unless the turn is stopped first. */
  private later(sessionId: string, ms: number, fn: () => void) {
    const p = this.pending.get(sessionId);
    if (!p) return;
    const t = setTimeout(() => {
      p.timers.delete(t);
      if (this.pending.get(sessionId) === p) fn();
    }, ms);
    p.timers.add(t);
  }

  /** Streaming path (only when the capability list says output streams): words arrive in chunks. */
  private streamReply(sessionId: string, reply: string, total: number) {
    const p = this.pending.get(sessionId)!;
    const words = reply.match(/\S+\s*|\s+/g) ?? [reply];
    const chunks: string[] = [];
    const per = Math.max(1, Math.ceil(words.length / 24));
    for (let i = 0; i < words.length; i += per) chunks.push(words.slice(i, i + per).join(''));
    const first = Math.round(total * 0.35);
    const step = Math.max(16, Math.round((total - first) / Math.max(1, chunks.length)));

    this.later(sessionId, first, () => {
      const items = this.data.transcripts[sessionId] ?? [];
      const msg: AssistantItem = {
        kind: 'assistant',
        id: `demo-itm-${rid()}`,
        at: Date.now(),
        text: '',
        streaming: true,
      };
      items.push(msg);
      p.assistantId = msg.id;
      p.handlers.onItem(copyItem(msg));
      let i = 0;
      const tick = () => {
        if (i < chunks.length) {
          msg.text += chunks[i++];
          p.handlers.onUpdate(copyItem(msg));
          this.later(sessionId, step, tick);
        } else {
          msg.streaming = false;
          p.handlers.onUpdate(copyItem(msg));
          this.finishTurn(sessionId, null);
        }
      };
      this.later(sessionId, step, tick);
    });
  }

  /** Complete the turn: activity done, reply appended (unless it was streamed), session idle. */
  private finishTurn(sessionId: string, reply: string | null) {
    const p = this.pending.get(sessionId);
    const s = this.findSession(sessionId);
    if (!p || !s) return;
    this.cancelTimers(sessionId);
    const items = (this.data.transcripts[sessionId] ??= []);
    const activity = items.find((i) => i.id === p.activityId);
    const now = Date.now();
    // The first reply starts the conversation (agy returns a conversation_id).
    s.conversationId ??= `demo-${rid()}`;
    if (activity && activity.kind === 'activity') {
      activity.status = 'done';
      activity.title = `Worked for ${Math.max(1, Math.round((now - activity.at) / 1000))} s (simulated)`;
      p.handlers.onUpdate(copyItem(activity));
    }
    if (reply !== null) {
      const msg: TranscriptItem = { kind: 'assistant', id: `demo-itm-${rid()}`, at: now, text: reply };
      items.push(msg);
      p.handlers.onItem(copyItem(msg));
    }
    s.messageCount += 1;
    s.status = 'idle';
    s.updatedAt = now;
    p.handlers.onDone(copySession(s));
    this.commit();
  }

  private stopTurn(sessionId: string) {
    const p = this.pending.get(sessionId);
    const s = this.findSession(sessionId);
    if (!p || !s) return;
    this.cancelTimers(sessionId);
    const items = (this.data.transcripts[sessionId] ??= []);
    const activity = items.find((i) => i.id === p.activityId);
    if (activity && activity.kind === 'activity') {
      activity.status = 'failed';
      activity.title = 'Stopped (simulated)';
      p.handlers.onUpdate(copyItem(activity));
    }
    const partial = p.assistantId ? items.find((i) => i.id === p.assistantId) : undefined;
    if (partial && partial.kind === 'assistant' && partial.streaming) {
      partial.streaming = false;
      p.handlers.onUpdate(copyItem(partial));
    }
    const notice: TranscriptItem = {
      kind: 'notice',
      id: `demo-itm-${rid()}`,
      at: Date.now(),
      text: STOP_NOTICE,
      tone: 'warning',
    };
    items.push(notice);
    p.handlers.onItem(copyItem(notice));
    s.status = 'stopped';
    s.updatedAt = Date.now();
    p.handlers.onDone(copySession(s));
    this.commit();
  }

  private cancelTimers(sessionId: string) {
    const p = this.pending.get(sessionId);
    if (!p) return;
    p.timers.forEach((t) => clearTimeout(t));
    p.timers.clear();
    this.pending.delete(sessionId);
  }

  /* ------------------------------------------------------------------ change notifications */

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    if (this.listeners.size === 1) {
      instances.add(this);
      if (typeof window !== 'undefined') window.addEventListener('storage', this.onStorage);
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        instances.delete(this);
        if (typeof window !== 'undefined') window.removeEventListener('storage', this.onStorage);
      }
    };
  }

  /** Settings → "Reset demo data": back to the sample sessions. */
  reset() {
    for (const [id, p] of [...this.pending]) {
      this.cancelTimers(id);
      p.handlers.onError(new Error('The demo data was reset, so this simulated turn ended.'));
    }
    this.data = buildSeed(Date.now());
    this.commit();
  }
}
