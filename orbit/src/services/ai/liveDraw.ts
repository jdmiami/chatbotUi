/**
 * Live draw's line to the AI machine: the drawing goes up, a picture comes back. Only one drawing is
 * ever on its way; while it is, a newer one waits in its place (older waiting ones are dropped), so
 * the preview never falls behind your pencil.
 *
 * A WebSocket (/_orbit/live/draw, the token as its second sub-protocol) is tried first; when it can't
 * open (a proxy in the way) or keeps dropping, each drawing is sent as one POST instead.
 */

export interface LiveAccess {
  url: string;
  token: string;
}

export interface LiveFrameRequest {
  prompt: string;
  /** "Follow my lines", 0..1 */
  follow: number;
  seed: number;
  /** PNG data URL: dark lines on white, 512 × 512 */
  image: string;
}

export interface LiveDrawState {
  installed: boolean;
  worker: 'off' | 'starting' | 'ready' | 'stopping';
  loading: string | null;
  error: string | null;
  lastMs: number | null;
  paused: string | null;
}

export interface LiveLinkEvents {
  /** A new preview: an image URL (data: or blob:) and how long the machine took. */
  onFrame(image: string, ms: number | null): void;
  /** Something went wrong with the last drawing (blocked words, paused, not installed, offline). */
  onError(message: string, info: { status?: number; blocked?: boolean; paused?: boolean }): void;
  /** Which way drawings travel. */
  onMode?(mode: 'socket' | 'post'): void;
}

type WsLike = {
  readyState: number;
  protocol?: string;
  send(data: string): void;
  close(): void;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
};

export interface LiveLinkOptions extends LiveLinkEvents {
  access: () => Promise<LiveAccess | null>;
  WebSocketImpl?: new (url: string, protocols?: string[]) => WsLike;
  fetchImpl?: typeof fetch;
  /** How long a drawing may take before it is given up (the first one loads the model). */
  timeoutMs?: number;
  /** How long the socket may take to open before POST takes over. */
  openMs?: number;
}

export class LiveDrawLink {
  private ws: WsLike | null = null;
  private wsReady: Promise<boolean> | null = null;
  private failures = 0;
  private mode: 'socket' | 'post' = 'socket';
  private inflight = false;
  private waiting: LiveFrameRequest | null = null;
  private seq = 0;
  private pending = new Map<number, (msg: Record<string, unknown>) => void>();
  private lastBlob: string | null = null;
  private closed = false;

  constructor(private o: LiveLinkOptions) {}

  get busy() {
    return this.inflight;
  }
  get via() {
    return this.mode;
  }

  /** Send the newest drawing (it replaces any drawing still waiting). */
  send(req: LiveFrameRequest) {
    if (this.closed) return;
    if (this.inflight) {
      this.waiting = req;
      return;
    }
    void this.run(req);
  }

  private async run(first: LiveFrameRequest) {
    let req: LiveFrameRequest | null = first;
    this.inflight = true;
    try {
      while (req && !this.closed) {
        await this.one(req);
        req = this.waiting;
        this.waiting = null;
      }
    } finally {
      this.inflight = false;
    }
  }

  private async one(req: LiveFrameRequest) {
    try {
      const msg = this.mode === 'socket' && (await this.socket()) ? await this.viaSocket(req) : await this.viaPost(req);
      if (this.closed || !msg) return;
      if (msg.type === 'frame') this.o.onFrame(String(msg.image), typeof msg.ms === 'number' ? msg.ms : null);
      else if (msg.type === 'error') this.o.onError(String(msg.error || 'Live draw hit a problem.'), { status: msg.status as number | undefined, blocked: Boolean(msg.blocked), paused: Boolean(msg.paused) });
    } catch (err) {
      if (!this.closed) this.o.onError((err as Error).message || 'Could not reach your AI machine.', {});
    }
  }

  /** The socket, opened on first use. False when it can't be had (POST takes over). */
  private socket(): Promise<boolean> {
    if (this.ws && this.ws.readyState === 1) return Promise.resolve(true);
    if (this.wsReady) return this.wsReady;
    const WS = this.o.WebSocketImpl ?? (typeof WebSocket !== 'undefined' ? (WebSocket as unknown as LiveLinkOptions['WebSocketImpl']) : undefined);
    if (!WS) return Promise.resolve(this.fallBack());
    this.wsReady = (async () => {
      const a = await this.o.access();
      if (!a) throw new Error('Your AI machine is not on yet.');
      return new Promise<boolean>((resolve) => {
        let settled = false;
        const done = (ok: boolean) => {
          if (settled) return;
          settled = true;
          clearTimeout(t);
          this.wsReady = null;
          resolve(ok ? true : this.fallBack());
        };
        let ws: WsLike;
        try {
          ws = new WS(`${a.url.replace(/^http/, 'ws')}/_orbit/live/draw`, ['orbit-live', a.token]);
        } catch {
          done(false);
          return;
        }
        const t = setTimeout(() => {
          ws.close();
          done(false);
        }, this.o.openMs ?? 5000);
        ws.onopen = () => {
          this.ws = ws;
          this.failures = 0;
          this.o.onMode?.('socket');
          done(true);
        };
        ws.onerror = () => done(false);
        ws.onclose = () => {
          if (this.ws === ws) this.ws = null;
          // Anything still waiting for an answer won't get one on this socket.
          for (const p of this.pending.values()) p({ type: 'error', error: 'The live connection dropped. Keep drawing to try again.' });
          this.pending.clear();
          done(false);
        };
        ws.onmessage = (ev) => {
          let msg: Record<string, unknown>;
          try {
            msg = JSON.parse(String(ev.data));
          } catch {
            return;
          }
          const p = this.pending.get(Number(msg.id));
          if (p) {
            this.pending.delete(Number(msg.id));
            p(msg);
          }
        };
      });
    })().catch((err: Error) => {
      this.wsReady = null;
      throw err;
    });
    return this.wsReady;
  }

  /** Two failed sockets in a row: POST from now on. */
  private fallBack(): boolean {
    this.failures++;
    if (this.failures >= 2 && this.mode !== 'post') {
      this.mode = 'post';
      this.o.onMode?.('post');
    }
    return false;
  }

  private viaSocket(req: LiveFrameRequest): Promise<Record<string, unknown> | null> {
    const ws = this.ws!;
    const id = ++this.seq;
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        if (this.pending.delete(id)) resolve({ type: 'error', error: 'Your AI machine took too long. Keep drawing to try again.' });
      }, this.o.timeoutMs ?? 120_000);
      this.pending.set(id, (msg) => {
        clearTimeout(t);
        resolve(msg.type === 'dropped' ? null : msg);
      });
      ws.send(JSON.stringify({ type: 'frame', id, prompt: req.prompt, follow: req.follow, seed: req.seed, image: req.image.replace(/^data:image\/png;base64,/, '') }));
    });
  }

  private async viaPost(req: LiveFrameRequest): Promise<Record<string, unknown> | null> {
    const a = await this.o.access();
    if (!a) throw new Error('Your AI machine is not on yet.');
    const f = this.o.fetchImpl ?? fetch;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.o.timeoutMs ?? 120_000);
    try {
      const res = await f(`${a.url}/_orbit/live/draw`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${a.token}` },
        body: JSON.stringify({ prompt: req.prompt, follow: req.follow, seed: req.seed, image: req.image }),
        signal: ctrl.signal,
      }).catch(() => {
        throw new Error(ctrl.signal.aborted ? 'Your AI machine took too long. Keep drawing to try again.' : 'Could not reach your AI machine.');
      });
      if (res.status === 204) return null;
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        return { type: 'error', error: body.error || `Your AI machine answered ${res.status}.`, status: res.status, blocked: body.blocked, paused: body.paused };
      }
      const blob = await res.blob();
      if (this.lastBlob) URL.revokeObjectURL(this.lastBlob);
      this.lastBlob = URL.createObjectURL(blob);
      const ms = Number(res.headers.get('x-live-ms'));
      return { type: 'frame', image: this.lastBlob, ms: Number.isFinite(ms) && ms > 0 ? ms : null };
    } finally {
      clearTimeout(t);
    }
  }

  close() {
    this.closed = true;
    this.waiting = null;
    this.ws?.close();
    this.ws = null;
    if (this.lastBlob) URL.revokeObjectURL(this.lastBlob);
    this.lastBlob = null;
  }
}
