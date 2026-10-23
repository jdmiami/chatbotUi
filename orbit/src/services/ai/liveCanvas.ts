/**
 * Live Draw's drawing machine (docs/livedraw/DESIGN.md §4–5): its power and price from the site, a
 * 1-hour token for it (refreshed before it runs out), the live link that sends the canvas and gets a
 * picture back, Bring to life (a live video session from the canvas), and its HTTP calls (sketch
 * reader, Finish). Built from services/ai/liveDraw.ts's
 * link: only one frame is ever on its way; while it is, the newest frame waits in its place (older
 * waiting ones are dropped), so the picture never falls behind the pencil. A WebSocket
 * (/_orbit/canvas/live, the token as its second sub-protocol) is tried first; when it can't open (a
 * proxy in the way) or keeps dropping, each frame is POSTed to /_orbit/canvas/frame instead.
 */
import type { StudioItem, StudioJob } from './LocalAi';

export type CanvasEngine = 'fast' | 'licensed';
export type CanvasMachineState = 'unconfigured' | 'off' | 'starting' | 'downloading' | 'on' | 'error';
export type CanvasSize = 512 | 768 | 1024;
export type EngineState = 'off' | 'loading' | 'ready' | 'error';

/** GET/POST /api/canvas */
export interface CanvasStatus {
  state: CanvasMachineState;
  pricePerHour: number | null;
  costPerHour: number | null;
  gpu?: string | null;
  autoOffMinutes?: number | null;
  idle?: { limitMinutes?: number; idleMinutes?: number; offAt?: string | null } | null;
  detail?: string;
}

/** POST /api/canvas/token */
export interface CanvasTokenReply {
  status?: CanvasMachineState;
  url: string | null;
  token: string | null;
  expiresIn: number;
  engine: CanvasEngine;
}

export interface CanvasGrant {
  url: string;
  token: string;
  engine: CanvasEngine;
  /** ms since the epoch */
  expires: number;
}

/** One frame of the canvas (§5.1). */
export interface CanvasFrame {
  type: 'frame';
  id: number;
  engine: CanvasEngine;
  mode: 'live' | 'paint';
  prompt: string;
  seed: number;
  follow: number;
  strength: number;
  size: CanvasSize;
  sketch: string;
  color?: string;
  base?: string;
  mask?: string;
  regions?: { mask: string; prompt: string }[];
  pose?: string;
  ref?: { image: string; weight: number };
}
/** What the app hands the link: the link numbers it. */
export type CanvasFrameInput = Omit<CanvasFrame, 'type' | 'id'>;

export type CanvasReply =
  | { type: 'frame'; id: number; image: string; ms: number }
  | { type: 'error'; id: number; error: string; blocked?: boolean; paused?: boolean; status?: number }
  | { type: 'state'; engines: Record<CanvasEngine, EngineState>; loading?: string };

/** GET /_orbit/canvas */
export interface CanvasInfo {
  engines: Record<CanvasEngine, EngineState>;
  living: EngineState;
  animate: EngineState;
  finish: EngineState;
  reader: EngineState;
  gpu?: { name: string; memoryGb: number } | null;
}

export interface SketchGuess {
  label: string;
  prompt: string;
}

export class CanvasError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
  }
}

type Fetch = typeof fetch;
const STATES: CanvasMachineState[] = ['unconfigured', 'off', 'starting', 'downloading', 'on', 'error'];
const OFF_LINE = 'Your drawing machine is not on yet.';

async function siteJson<T>(f: Fetch, path: string, init?: RequestInit): Promise<T> {
  const res = await f(path, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) }, cache: 'no-store', credentials: 'same-origin' });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 401) throw new CanvasError('Your sign-in expired. Reload to sign in again.', 401);
  if (!res.ok) throw new CanvasError(typeof body.error === 'string' ? body.error : `Request failed (${res.status})`, res.status);
  return body as T;
}

function asStatus(s: CanvasStatus): CanvasStatus {
  if (!s || !STATES.includes(s.state)) throw new CanvasError('The site didn’t say how the drawing machine is. Reload to try again.');
  return s;
}

/**
 * Which door Live Draw uses. Inside Orbit it is the owner's: the site's /api/canvas routes and the
 * machine's /_orbit/canvas/*. A studio can host Live Draw for its members: /api/studio/canvas (state,
 * address and a member token in one answer, always the licensed engine) and the machine's
 * /_studio/canvas/*. Members have no living canvas and can't upload a style reference.
 */
export type CanvasDoor = 'owner' | 'member';

export interface DoorPaths {
  door: CanvasDoor;
  /** GET: status (members: with url + token); POST { action }. */
  status: string;
  /** POST: the owner's token (members get theirs from `status`). */
  token: string | null;
  /** The machine's canvas routes: `${machine}/live`, `/frame`, `/read`, `/finish`, `/warm`. */
  machine: string;
  /** Following a job: `${jobs}/:id`. */
  jobs: string;
  /** Bring to life: the live video route and its maker (owner: Krea Realtime; member: StreamDiffusionV2, licensed). */
  liveVideo: string;
  liveMaker: 'live-krea' | 'live-sdv2';
  /** Members can't upload a style reference. */
  styleRef: boolean;
}

export function doorPaths(door: CanvasDoor = 'owner', studio = ''): DoorPaths {
  if (door === 'member') {
    return {
      door,
      status: `/api/studio/canvas${studio ? `?studio=${encodeURIComponent(studio)}` : ''}`,
      token: null,
      machine: '/_studio/canvas',
      jobs: '/_studio/jobs',
      liveVideo: '/_studio/live/video',
      liveMaker: 'live-sdv2',
      styleRef: false,
    };
  }
  return { door, status: '/api/canvas', token: '/api/canvas/token', machine: '/_orbit/canvas', jobs: '/_orbit/studio/jobs', liveVideo: '/_orbit/live/video', liveMaker: 'live-krea', styleRef: true };
}

/** The engine a frame may use: the site's licensed engine is never swapped for fast. */
export function allowedEngine(wanted: CanvasEngine, site: CanvasEngine | null): CanvasEngine {
  return site === 'licensed' ? 'licensed' : wanted;
}

/**
 * The drawing machine's address and token. A cached grant is used until two minutes before it runs
 * out; then (or when forced, after a 401) a fresh one is fetched. Calls at the same moment share one
 * request. `engine` is what the site decided (owner: fast; studio member: licensed).
 */
export class CanvasAccess {
  private grant: CanvasGrant | null = null;
  private inflight: Promise<CanvasGrant | null> | null = null;
  /** The site's engine for this person, known after the first token (even while the machine is off). */
  engine: CanvasEngine | null = null;

  constructor(
    private f: Fetch = (...a) => fetch(...a),
    private now: () => number = Date.now,
    private earlyMs = 120_000,
    readonly paths: DoorPaths = doorPaths('owner'),
  ) {
    if (paths.door === 'member') this.engine = 'licensed';
  }

  get(force = false): Promise<CanvasGrant | null> {
    if (!force && this.grant && this.grant.expires - this.now() > this.earlyMs) return Promise.resolve(this.grant);
    if (this.inflight) return this.inflight;
    const member = this.paths.door === 'member';
    // A member's address and token come with the studio's status; the owner asks for a token.
    const ask = member ? siteJson<CanvasTokenReply>(this.f, this.paths.status) : siteJson<CanvasTokenReply>(this.f, this.paths.token!, { method: 'POST', body: '{}' });
    this.inflight = ask
      .then((r) => {
        // A member is always on the licensed engine, whatever an answer says.
        if (member) this.engine = 'licensed';
        else if (r.engine === 'fast' || r.engine === 'licensed') this.engine = r.engine;
        this.grant = r.url && r.token ? { url: r.url.replace(/\/+$/, ''), token: r.token, engine: this.engine ?? 'licensed', expires: this.now() + (Number(r.expiresIn) || 3600) * 1000 } : null;
        return this.grant;
      })
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }

  /** The grant in hand (no fetching). */
  get current(): CanvasGrant | null {
    return this.grant;
  }

  forget() {
    this.grant = null;
  }
}

type WsLike = {
  readyState: number;
  bufferedAmount?: number;
  send(data: string): void;
  close(): void;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
};
export type WsCtor = new (url: string, protocols?: string[]) => WsLike;

export interface CanvasLinkOptions {
  access: (force?: boolean) => Promise<CanvasGrant | null>;
  /** The machine's canvas routes (default the owner's /_orbit/canvas). */
  base?: string;
  /** The site's engine: 'licensed' is never overridden by a frame. */
  siteEngine?: () => CanvasEngine | null;
  /** A new picture, how long it took, and the frame it answers. */
  onFrame(image: string, ms: number | null, id: number): void;
  /** The last frame could not be made (blocked words, paused, the other engine needed, offline). */
  onError(message: string, info: { status?: number; blocked?: boolean; paused?: boolean; id?: number }): void;
  /** The engines on the machine (sent by it whenever they change). */
  onState?(engines: Record<CanvasEngine, EngineState>, loading?: string): void;
  /** Which way frames travel. */
  onMode?(mode: 'socket' | 'post'): void;
  WebSocketImpl?: WsCtor;
  fetchImpl?: Fetch;
  /** How long a frame may take before it is given up (the first one may load the model). */
  timeoutMs?: number;
  /** How long the socket may take to open before POST takes over. */
  openMs?: number;
}

type Reply = Record<string, unknown>;

export class CanvasLink {
  private ws: WsLike | null = null;
  private wsReady: Promise<boolean> | null = null;
  private failures = 0;
  private mode: 'socket' | 'post' = 'socket';
  private inflight = false;
  private waiting: CanvasFrameInput | null = null;
  private seq = 0;
  private pending = new Map<number, (msg: Reply) => void>();
  private closed = false;
  /** Frames handed over (not all are sent: a newer one may replace a waiting one). */
  sent = 0;

  constructor(private o: CanvasLinkOptions) {}

  get busy() {
    return this.inflight;
  }
  get via() {
    return this.mode;
  }

  /** Send the newest frame (it replaces any frame still waiting). */
  send(frame: CanvasFrameInput) {
    if (this.closed) return;
    if (this.inflight) {
      this.waiting = frame;
      return;
    }
    void this.run(frame);
  }

  private async run(first: CanvasFrameInput) {
    let next: CanvasFrameInput | null = first;
    this.inflight = true;
    try {
      while (next && !this.closed) {
        await this.one(next);
        next = this.waiting;
        this.waiting = null;
      }
    } finally {
      this.inflight = false;
    }
  }

  private async one(input: CanvasFrameInput) {
    const frame: CanvasFrame = { type: 'frame', id: ++this.seq, ...input, engine: allowedEngine(input.engine, this.o.siteEngine?.() ?? null) };
    this.sent++;
    try {
      const msg = this.mode === 'socket' && (await this.socket()) ? await this.viaSocket(frame) : await this.viaPost(frame);
      if (this.closed || !msg) return;
      this.handle(msg, frame.id);
    } catch (err) {
      if (!this.closed) this.o.onError((err as Error).message || 'Could not reach your drawing machine.', { id: frame.id });
    }
  }

  /** One reply from the machine (socket or POST). */
  private handle(msg: Reply, id = Number(msg.id)) {
    if (msg.type === 'frame' && typeof msg.image === 'string') this.o.onFrame(msg.image, typeof msg.ms === 'number' ? msg.ms : null, id);
    else if (msg.type === 'error') this.o.onError(String(msg.error || 'The drawing machine hit a problem.'), { id, status: typeof msg.status === 'number' ? msg.status : undefined, blocked: Boolean(msg.blocked), paused: Boolean(msg.paused) });
    else if (msg.type === 'state' && msg.engines && typeof msg.engines === 'object') this.o.onState?.(msg.engines as Record<CanvasEngine, EngineState>, typeof msg.loading === 'string' ? msg.loading : undefined);
  }

  /** The socket, opened on first use. False when it can't be had (POST takes over). */
  private socket(): Promise<boolean> {
    if (this.ws && this.ws.readyState === 1) return Promise.resolve(true);
    if (this.wsReady) return this.wsReady;
    const WS = this.o.WebSocketImpl ?? (typeof WebSocket !== 'undefined' ? (WebSocket as unknown as WsCtor) : undefined);
    if (!WS) {
      this.toPost();
      return Promise.resolve(false);
    }
    this.wsReady = (async () => {
      const a = await this.o.access();
      if (!a) throw new CanvasError(OFF_LINE, 503);
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
          ws = new WS(`${a.url.replace(/^http/, 'ws')}${this.o.base ?? '/_orbit/canvas'}/live`, ['orbit-live', a.token]);
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
          let msg: Reply;
          try {
            msg = JSON.parse(String(ev.data));
          } catch {
            return;
          }
          const p = this.pending.get(Number(msg.id));
          if (p && (msg.type === 'frame' || msg.type === 'error')) {
            this.pending.delete(Number(msg.id));
            p(msg);
          } else this.handle(msg); // engine state, or an error about no frame in particular
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
    if (this.failures >= 2) this.toPost();
    return false;
  }
  private toPost() {
    if (this.mode === 'post') return;
    this.mode = 'post';
    this.o.onMode?.('post');
  }

  private viaSocket(frame: CanvasFrame): Promise<Reply | null> {
    const ws = this.ws!;
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        if (this.pending.delete(frame.id)) resolve({ type: 'error', error: 'Your drawing machine took too long. Keep drawing to try again.' });
      }, this.o.timeoutMs ?? 120_000);
      this.pending.set(frame.id, (msg) => {
        clearTimeout(t);
        resolve(msg);
      });
      ws.send(JSON.stringify(frame));
    });
  }

  private async viaPost(frame: CanvasFrame, retry = true, fresh?: CanvasGrant | null): Promise<Reply | null> {
    const a = fresh ?? (await this.o.access());
    if (!a) throw new CanvasError(OFF_LINE, 503);
    const f = this.o.fetchImpl ?? ((...args: Parameters<Fetch>) => fetch(...args));
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.o.timeoutMs ?? 120_000);
    try {
      const res = await f(`${a.url}${this.o.base ?? '/_orbit/canvas'}/frame`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${a.token}` },
        body: JSON.stringify(frame),
        signal: ctrl.signal,
      }).catch(() => {
        throw new CanvasError(ctrl.signal.aborted ? 'Your drawing machine took too long. Keep drawing to try again.' : 'Could not reach your drawing machine.');
      });
      if (res.status === 401 && retry) {
        const renewed = await this.o.access(true);
        return this.viaPost(frame, false, renewed);
      }
      if (res.status === 204) return null;
      const body = (await res.json().catch(() => ({}))) as Reply;
      if (!res.ok) return { type: 'error', id: frame.id, error: body.error || `Your drawing machine answered ${res.status}.`, status: res.status, blocked: body.blocked, paused: body.paused };
      return body;
    } finally {
      clearTimeout(t);
    }
  }

  close() {
    this.closed = true;
    this.waiting = null;
    for (const p of this.pending.values()) p({ type: 'dropped' });
    this.pending.clear();
    this.ws?.close();
    this.ws = null;
  }
}

export type LiveMaker = 'live-krea' | 'live-sdv2';
export type LivingState = 'connecting' | 'loading' | 'live' | 'stopped';

/**
 * Bring to life: the picture becomes video that keeps moving while you draw. A live session on the
 * machine's live video (/_orbit/live/video; Krea Realtime 14B for the owner, StreamDiffusionV2 on the
 * licensed engine for a member), as Live video did with the camera: start (maker, the canvas as
 * source, the words, the Motion strength), then the picture-with-strokes a few times a second
 * (skipped while the socket is backed up), new words and Motion mid-stream, "Save last 10 s".
 */
export class LivingLink {
  private ws: WsLike | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  /** Frames sent up (for tests and the status line). */
  sent = 0;

  constructor(
    private o: {
      access: () => Promise<CanvasGrant | null>;
      /** The live video route on the machine (default the owner's). */
      path?: string;
      maker?: LiveMaker;
      /** The picture with the strokes on it, as a JPEG data URL (or null while there is nothing to send). */
      source: () => string | null;
      onFrame(image: string): void;
      onState(state: LivingState): void;
      onError(message: string, info?: { blocked?: boolean; status?: number }): void;
      onSaved?(item: StudioItem | null): void;
      WebSocketImpl?: WsCtor;
      fps?: number;
    },
  ) {}

  get running() {
    return !this.stopped && Boolean(this.ws);
  }

  async start(prompt: string, strength: number) {
    this.o.onState('connecting');
    const a = await this.o.access();
    if (!a) throw new CanvasError(OFF_LINE, 503);
    if (this.stopped) return;
    const WS = this.o.WebSocketImpl ?? (WebSocket as unknown as WsCtor);
    const ws = new WS(`${a.url.replace(/^http/, 'ws')}${this.o.path ?? '/_orbit/live/video'}`, ['orbit-live', a.token]);
    this.ws = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'start', maker: this.o.maker ?? 'live-krea', source: 'canvas', prompt, strength }));
      // The picture goes up straight away, so the video starts from it.
      this.push();
    };
    ws.onmessage = (ev) => {
      let m: Reply;
      try {
        m = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (m.type === 'state') {
        if (m.state === 'loading') this.o.onState('loading');
        if (m.state === 'live') {
          this.o.onState('live');
          this.capture();
        }
        if (m.state === 'stopped') this.stop();
      } else if (m.type === 'frame' && typeof m.image === 'string') this.o.onFrame(m.image);
      else if (m.type === 'saved') this.o.onSaved?.((m.item as StudioItem) ?? null);
      else if (m.type === 'error') this.o.onError(String(m.error || 'Bring to life hit a problem.'), { blocked: Boolean(m.blocked), status: typeof m.status === 'number' ? m.status : undefined });
    };
    ws.onerror = () => this.o.onError('Could not reach your drawing machine to bring it to life.');
    ws.onclose = () => {
      if (this.ws === ws) this.stop();
    };
  }

  /** One frame of the canvas up, unless the socket is backed up (live beats complete). */
  private push() {
    const w = this.ws;
    if (!w || w.readyState !== 1 || (w.bufferedAmount ?? 0) > 512 * 1024) return;
    const image = this.o.source();
    if (!image) return;
    w.send(JSON.stringify({ type: 'frame', image }));
    this.sent++;
  }

  private capture() {
    if (this.timer) return;
    this.timer = setInterval(() => this.push(), 1000 / (this.o.fps ?? 8));
  }

  /** Keep the last 10 seconds: they land in the gallery (onSaved). */
  save() {
    this.say({ type: 'save' });
  }

  private say(msg: Reply) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(msg));
  }
  setPrompt(prompt: string) {
    this.say({ type: 'prompt', prompt });
  }
  setStrength(strength: number) {
    this.say({ type: 'strength', strength });
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.say({ type: 'stop' });
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const w = this.ws;
    this.ws = null;
    if (w && w.readyState <= 1) w.close();
    this.o.onState('stopped');
  }
}

/** A short line when an error says a feature needs the other engine (or null). */
export function otherEngineLine(error: string, engine: CanvasEngine, canSwitch: boolean): string | null {
  const other: CanvasEngine = engine === 'fast' ? 'licensed' : 'fast';
  if (!/\bengine\b/i.test(error) || !new RegExp(`\\b(${other}|other)\\b`, 'i').test(error)) return null;
  const name = other === 'fast' ? 'the fast engine' : 'the licensed engine';
  return canSwitch ? `That needs ${name}: switch it in Options.` : `That needs ${name}, which isn’t available here.`;
}

/** The drawing machine: power, access and its HTTP calls (§4, §5.2), through the owner's or a member's door. */
export class LiveCanvasApi {
  readonly access: CanvasAccess;
  readonly paths: DoorPaths;
  private f: Fetch;

  constructor(fetchImpl?: Fetch, opts: { door?: CanvasDoor; studio?: string; access?: CanvasAccess } = {}) {
    this.f = fetchImpl ?? ((...a) => fetch(...a));
    this.paths = opts.access?.paths ?? doorPaths(opts.door, opts.studio);
    this.access = opts.access ?? new CanvasAccess(this.f, Date.now, 120_000, this.paths);
  }

  /** May the engine be switched here? Only by the owner, and only when the site gave fast. */
  get canSwitchEngine() {
    return this.paths.door === 'owner' && this.access.engine === 'fast';
  }

  async status(): Promise<CanvasStatus> {
    return asStatus(await siteJson<CanvasStatus>(this.f, this.paths.status));
  }

  async power(action: 'start' | 'stop'): Promise<CanvasStatus> {
    const s = asStatus(await siteJson<CanvasStatus>(this.f, this.paths.status, { method: 'POST', body: JSON.stringify({ action }) }));
    if (action === 'stop') this.access.forget();
    return s;
  }

  /** A call to the drawing machine, signed in; a 401 gets a fresh token once. */
  private async call<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
    const g = await this.access.get();
    if (!g) throw new CanvasError(OFF_LINE, 503);
    const res = await this.f(`${g.url}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init.headers ?? {}), authorization: `Bearer ${g.token}` },
    }).catch(() => {
      throw new CanvasError('Could not reach your drawing machine. It may be starting or just turned itself off.');
    });
    if (res.status === 401 && retry) {
      await this.access.get(true);
      return this.call<T>(path, init, false);
    }
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const msg = typeof body.error === 'string' ? body.error : (body.error as { message?: string } | undefined)?.message;
      throw new CanvasError(msg || `Your drawing machine answered ${res.status}.`, res.status);
    }
    return body as T;
  }

  private absolute(job: StudioJob): StudioJob {
    const base = this.access.current?.url;
    if (!job.item || !base || !job.item.url || /^(https?|data|blob):/.test(job.item.url)) return job;
    return { ...job, item: { ...job.item, url: base + job.item.url } };
  }

  info(): Promise<CanvasInfo> {
    return this.call<CanvasInfo>(this.paths.machine);
  }
  warm(engine: CanvasEngine): Promise<{ ok: boolean }> {
    return this.call(`${this.paths.machine}/warm`, { method: 'POST', body: JSON.stringify({ engine: allowedEngine(engine, this.access.engine) }) });
  }
  async read(image: string): Promise<SketchGuess[]> {
    const r = await this.call<{ guesses?: SketchGuess[] }>(`${this.paths.machine}/read`, { method: 'POST', body: JSON.stringify({ image }) });
    return (Array.isArray(r.guesses) ? r.guesses : []).filter((g) => g && typeof g.label === 'string' && g.label.trim()).slice(0, 3);
  }
  async finish(req: { image: string; sketch: string; prompt: string; engine: CanvasEngine; size: CanvasSize }): Promise<StudioJob> {
    await this.access.get(); // the site's engine is known once a token was asked for
    const body = { ...req, engine: allowedEngine(req.engine, this.access.engine) };
    return this.absolute(await this.call<StudioJob>(`${this.paths.machine}/finish`, { method: 'POST', body: JSON.stringify(body) }));
  }
  async job(id: string): Promise<StudioJob> {
    return this.absolute(await this.call<StudioJob>(`${this.paths.jobs}/${encodeURIComponent(id)}`));
  }
  async cancelJob(id: string): Promise<void> {
    await this.call(`${this.paths.jobs}/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: '{}' });
  }

  link(o: Omit<CanvasLinkOptions, 'access' | 'base' | 'siteEngine'>): CanvasLink {
    return new CanvasLink({ ...o, base: this.paths.machine, siteEngine: () => this.access.engine, access: (force) => this.access.get(force) });
  }
  /** Bring to life: a live video session from the canvas, with this door's route and maker. */
  living(o: Omit<ConstructorParameters<typeof LivingLink>[0], 'access' | 'path' | 'maker'>): LivingLink {
    return new LivingLink({ ...o, path: this.paths.liveVideo, maker: this.paths.liveMaker, access: () => this.access.get() });
  }
}

/** Follow a studio job until it is done (or stopped): every `everyMs`, until `signal` aborts. */
export async function followJob(api: Pick<LiveCanvasApi, 'job'>, first: StudioJob, onUpdate: (j: StudioJob) => void, signal?: AbortSignal, everyMs = 2000): Promise<StudioJob> {
  let j = first;
  onUpdate(j);
  while ((j.status === 'queued' || j.status === 'running') && !signal?.aborted) {
    await new Promise((r) => setTimeout(r, everyMs));
    if (signal?.aborted) break;
    try {
      j = await api.job(j.id);
      onUpdate(j);
    } catch {
      /* a missed poll: try again */
    }
  }
  return j;
}

let shared: LiveCanvasApi | null = null;
/** Orbit's own, through the owner's door. A studio makes its own: new LiveCanvasApi(undefined, { door: 'member', studio }). */
export function getLiveCanvas(): LiveCanvasApi {
  shared ??= new LiveCanvasApi();
  return shared;
}
