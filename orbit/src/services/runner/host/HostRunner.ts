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
import { HostError, type HostClient } from '../../host/connection';

type WatchHandlers = Pick<SendHandlers, 'onItem' | 'onUpdate' | 'onDone'>;

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => (clearTimeout(t), resolve()), { once: true });
  });

/** A 4xx from the host (unknown session, not authorised...) won't get better by retrying. */
const isFinal = (err: unknown) => err instanceof HostError && err.status >= 400 && err.status < 500;

/**
 * Real Antigravity runner: the Orbit host on the Linux machine runs the installed `agy` CLI
 * (one `agy --print` per turn, continuing with `--conversation <id>`) and stores sessions there,
 * so iPhone and iPad share the same history.
 */
export class HostRunner implements RunnerAdapter {
  readonly kind = 'antigravity-cli' as const;
  readonly label = 'Antigravity CLI on your Linux machine';
  capabilities: RunnerCapabilities = AGY_CAPABILITIES;

  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastFingerprint = '';

  constructor(private readonly host: HostClient) {
    // Use the host's own capability list (it is the one actually running agy).
    void this.host
      .json<RunnerCapabilities>('/agent/capabilities')
      .then((caps) => {
        this.capabilities = caps;
        this.emit();
      })
      .catch(() => {});
  }

  listProjects(): Promise<Project[]> {
    return this.host.json<Project[]>('/agent/projects');
  }

  listSessions(projectId: string): Promise<SessionSummary[]> {
    return this.host.json<SessionSummary[]>(`/agent/sessions?project=${encodeURIComponent(projectId)}`);
  }

  async getSession(sessionId: string): Promise<SessionSummary | undefined> {
    try {
      return await this.host.json<SessionSummary>(`/agent/sessions/${encodeURIComponent(sessionId)}`);
    } catch {
      return undefined;
    }
  }

  getTranscript(sessionId: string): Promise<TranscriptItem[]> {
    return this.host.json<TranscriptItem[]>(`/agent/sessions/${encodeURIComponent(sessionId)}/transcript`);
  }

  async createSession(
    projectId: string,
    opts: { title?: string; model?: string; mode?: RunnerMode } = {},
  ): Promise<SessionSummary> {
    const s = await this.host.json<SessionSummary>('/agent/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId, ...opts }),
    });
    this.emit();
    return s;
  }

  async updateSession(
    sessionId: string,
    patch: Partial<Pick<SessionSummary, 'title' | 'model' | 'mode'>>,
  ): Promise<SessionSummary> {
    const s = await this.host.json<SessionSummary>(`/agent/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    });
    this.emit();
    return s;
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.host.json(`/agent/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
    this.emit();
  }

  listModels(): Promise<ModelOption[]> {
    return this.host.json<ModelOption[]>('/agent/models');
  }

  send(sessionId: string, text: string, handlers: SendHandlers): RunHandle {
    const abort = new AbortController();
    let settled = false;
    let started = false; // the host accepted the turn (its first item arrived)
    const done = (s: SessionSummary) => {
      if (settled) return;
      settled = true;
      handlers.onDone(s);
      this.emit();
    };
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      handlers.onError(err);
    };
    void this.host
      .stream(
        `/agent/sessions/${encodeURIComponent(sessionId)}/send`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text }),
          signal: abort.signal,
        },
        (event, data) => {
          if (event === 'item') {
            started = true;
            handlers.onItem(data as TranscriptItem);
          } else if (event === 'update') handlers.onUpdate(data as TranscriptItem);
          else if (event === 'done') done(data as SessionSummary);
          else if (event === 'error') fail(new Error((data as { message?: string }).message ?? 'Failed'));
        },
      )
      .then(
        // The stream ended without 'done' (phone locked, network change, proxy dropped it):
        // the turn keeps running on the machine, so re-attach and catch up.
        () => (settled || abort.signal.aborted ? undefined : this.resume(sessionId, handlers, abort.signal, done)),
        (err: Error) => {
          if (settled || abort.signal.aborted) return;
          if (!started) return fail(err);
          return this.resume(sessionId, handlers, abort.signal, done);
        },
      )
      .catch((err: Error) => {
        if (!abort.signal.aborted) fail(err);
      });
    return {
      stop: () => {
        // Ask the host to end the agy process; the 'done' event arrives on the stream.
        void this.stopSession(sessionId).catch((err: Error) => {
          abort.abort();
          fail(new Error(`Couldn't reach the Linux machine to stop this turn (${err.message}).`));
        });
      },
    };
  }

  /** Stop a running turn by session id (also works for a turn started on another device). */
  stopSession(sessionId: string): Promise<{ stopped: boolean }> {
    return this.host.json<{ stopped: boolean }>(`/agent/sessions/${encodeURIComponent(sessionId)}/stop`, {
      method: 'POST',
    });
  }

  /** After a dropped reply stream: follow the turn to its end, then fill in anything missed meanwhile. */
  private async resume(
    sessionId: string,
    handlers: SendHandlers,
    signal: AbortSignal,
    done: (s: SessionSummary) => void,
  ) {
    await this.watch(sessionId, { onItem: handlers.onItem, onUpdate: handlers.onUpdate, onDone: () => {} }, signal);
    if (signal.aborted) return;
    const [items, session] = await Promise.all([
      this.getTranscript(sessionId),
      this.host.json<SessionSummary>(`/agent/sessions/${encodeURIComponent(sessionId)}`),
    ]);
    if (signal.aborted) return;
    // Items are merged by id, so re-sending ones already shown just refreshes them.
    items.forEach((item) => handlers.onUpdate(item));
    done(session);
  }

  /**
   * Follow a turn that is running on the machine but was started elsewhere (e.g. on the other
   * device, or before this page reloaded). Resolves when it finishes.
   */
  async watch(sessionId: string, handlers: WatchHandlers, signal?: AbortSignal): Promise<void> {
    // If the connection drops before the turn ends, re-attach with backoff (the turn keeps running).
    for (let attempt = 0; ; attempt++) {
      let ended = false;
      try {
        await this.host.stream(
          `/agent/sessions/${encodeURIComponent(sessionId)}/events`,
          { method: 'GET', signal },
          (event, data) => {
            if (event === 'item') handlers.onItem(data as TranscriptItem);
            else if (event === 'update') handlers.onUpdate(data as TranscriptItem);
            else if (event === 'done' || event === 'idle') {
              ended = true;
              handlers.onDone(data as SessionSummary);
            }
          },
        );
      } catch (err) {
        if (signal?.aborted) return;
        if (isFinal(err)) throw err;
      }
      if (ended || signal?.aborted) return;
      if (attempt >= HostRunner.WATCH_RETRIES) {
        throw new HostError(
          'Lost the connection to the Linux machine. Antigravity keeps working there; reopen the session to see the result.',
          0,
        );
      }
      await sleep(Math.min(15_000, HostRunner.WATCH_BACKOFF_MS * 2 ** attempt), signal);
    }
  }

  /** Re-attach attempts after a dropped stream (about a minute in total with the backoff). */
  static WATCH_RETRIES = 6;
  static WATCH_BACKOFF_MS = 1000;

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    // Poll so sessions created or updated on the other device show up here.
    if (!this.timer) this.timer = setInterval(() => void this.poll(), 10_000);
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0 && this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    };
  }

  /** Nothing to reset on the server (sessions are real). */
  reset() {}

  private async poll() {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    try {
      const all = await this.host.json<SessionSummary[]>('/agent/sessions');
      const fp = all.map((s) => `${s.id}:${s.updatedAt}:${s.status}`).join('|');
      if (fp !== this.lastFingerprint) {
        this.lastFingerprint = fp;
        this.emit();
      }
    } catch {
      /* transient */
    }
  }

  private emit() {
    this.listeners.forEach((l) => l());
  }
}
