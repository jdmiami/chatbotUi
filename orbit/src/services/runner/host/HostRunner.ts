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
import type { HostClient } from '../../host/connection';

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
          if (event === 'item') handlers.onItem(data as TranscriptItem);
          else if (event === 'update') handlers.onUpdate(data as TranscriptItem);
          else if (event === 'done') {
            handlers.onDone(data as SessionSummary);
            this.emit();
          } else if (event === 'error') handlers.onError(new Error((data as { message?: string }).message ?? 'Failed'));
        },
      )
      .catch((err: Error) => {
        if (abort.signal.aborted) return;
        handlers.onError(err);
      });
    return {
      stop: () => {
        // Ask the host to end the agy process; the 'done' event arrives on the stream.
        void this.host
          .json(`/agent/sessions/${encodeURIComponent(sessionId)}/stop`, { method: 'POST' })
          .catch(() => abort.abort());
      },
    };
  }

  /**
   * Follow a turn that is running on the machine but was started elsewhere (e.g. on the other
   * device, or before this page reloaded). Resolves when it finishes.
   */
  watch(sessionId: string, handlers: Pick<SendHandlers, 'onItem' | 'onUpdate' | 'onDone'>, signal?: AbortSignal) {
    return this.host.stream(
      `/agent/sessions/${encodeURIComponent(sessionId)}/events`,
      { method: 'GET', signal },
      (event, data) => {
        if (event === 'item') handlers.onItem(data as TranscriptItem);
        else if (event === 'update') handlers.onUpdate(data as TranscriptItem);
        else if (event === 'done' || event === 'idle') handlers.onDone(data as SessionSummary);
      },
    );
  }

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
