// Live makers: models that answer in a fraction of a second, so you see the result while you draw
// (Live draw: pix2pix-turbo). Each runs as one long-lived Python worker in the studio's own Python
// (like the NSFW check, nsfwcheck.js), started the first time it is needed and stopped after a few
// quiet minutes so its graphics memory goes back to the chat models and the image and video maker.
//
// The worker speaks one JSON object per line: requests on stdin ({ id, op, ... }), answers on stdout
// ({ id, ... } or { id, error }). Its first line is { ready: true } once the model is loaded;
// { loading: "..." } lines before that say what it is doing.
import { spawn as nodeSpawn } from 'node:child_process';
import fs from 'node:fs';
import readline from 'node:readline';
import { BLOCKED_MESSAGE, blockedPrompt } from './studio.js';

/**
 * o: { name, python, script, env, spawn (tests), idleMs, timeoutMs, startTimeoutMs, log, now,
 *      onEvent (msg) => void: every line that answers no request (the canvas worker's engine progress) }
 * Never throws on its own: a worker that can't start answers every request with an error.
 */
export function createLiveWorker(o) {
  const { name, python, script, log = console } = o;
  const run = o.spawn || nodeSpawn;
  const now = o.now || Date.now;
  const idleMs = o.idleMs ?? 4 * 60_000;
  const timeoutMs = o.timeoutMs ?? 60_000;
  const startTimeoutMs = o.startTimeoutMs ?? 10 * 60_000;
  let w = null; // { child, ready: Promise<boolean>, pending: Map, state }
  let seq = 0;
  let lastUse = 0;
  let lastError = null;
  let loading = null;
  let retryAt = 0;

  function start() {
    if (w) return w;
    if (now() < retryAt) return null;
    if (!python || !fs.existsSync(python)) {
      lastError = 'The studio’s Python is not installed yet (the image and video maker sets it up on first start).';
      return null;
    }
    if (!script || !fs.existsSync(script)) {
      lastError = `${name}: its worker script is missing.`;
      return null;
    }
    // Never sees the gate's secrets.
    const env = { ...process.env, ...(o.env || {}) };
    for (const k of ['GATEWAY_SECRET', 'RUNPOD_API_KEY', 'STUDIO_KEY', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'HF_TOKEN', 'HUGGING_FACE_HUB_TOKEN']) delete env[k];
    const child = run(python, [script], { stdio: ['pipe', 'pipe', 'pipe'], env });
    const pending = new Map();
    let markReady;
    const ready = new Promise((resolve) => (markReady = resolve));
    const me = { child, ready, pending, state: 'starting', startedAt: now() };
    loading = 'Starting';
    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      // Lines that answer no request (ready, loading, a worker's own progress events) also go to onEvent.
      if (msg?.id == null && o.onEvent) {
        try {
          o.onEvent(msg);
        } catch (err) {
          log.warn?.(`[live] ${name}: ${err.message}`);
        }
      }
      if (msg.ready) {
        me.state = 'ready';
        loading = null;
        lastError = null;
        return markReady(true);
      }
      if (msg.loading) {
        loading = String(msg.loading).slice(0, 200);
        return;
      }
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      p(msg);
    });
    let errTail = '';
    child.stderr?.on('data', (d) => (errTail = (errTail + d).slice(-2000)));
    const gone = (why) => {
      if (w !== me) return;
      w = null;
      loading = null;
      markReady(false);
      for (const p of pending.values()) p({ error: why });
      pending.clear();
      if (me.state !== 'stopping') {
        const last = errTail.trim().split('\n').pop() || '';
        lastError = `${name} stopped (${why})${last ? `: ${last.slice(0, 300)}` : ''}`;
        // A crash at start (missing package, no graphics card) would repeat on every stroke: wait a bit.
        retryAt = now() + 30_000;
        log.warn?.(`[live] ${lastError}`);
      }
    };
    child.on('error', (err) => gone(err.message));
    child.on('exit', (code, signal) => gone(signal ? `signal ${signal}` : `exit ${code}`));
    w = me;
    const t = setTimeout(() => {
      if (w === me && me.state === 'starting') {
        lastError = `${name} took too long to load.`;
        stop();
      }
    }, startTimeoutMs);
    t.unref?.();
    return me;
  }

  function stop() {
    if (!w) return;
    const me = w;
    me.state = 'stopping';
    w = null;
    loading = null;
    for (const p of me.pending.values()) p({ error: 'stopped' });
    me.pending.clear();
    try {
      me.child.stdin?.end();
      me.child.kill('SIGTERM');
    } catch {
      /* already gone */
    }
  }

  // Quiet for a while: stop, so its graphics memory is free again.
  const idleTimer = setInterval(() => {
    if (w && !w.pending.size && lastUse && now() - lastUse > idleMs) {
      log.info?.(`[live] ${name}: unused for ${Math.round(idleMs / 60000)} min, unloading it`);
      stop();
    }
  }, Math.min(30_000, Math.max(1000, Math.floor(idleMs / 4))));
  idleTimer.unref?.();

  async function request(msg, { timeout = timeoutMs } = {}) {
    lastUse = now();
    const me = start();
    if (!me) return { error: lastError || `${name} can't start right now.` };
    if (!(await me.ready)) return { error: lastError || `${name} could not load.` };
    const id = `r${++seq}`;
    const answer = new Promise((resolve) => {
      me.pending.set(id, resolve);
      const t = setTimeout(() => {
        if (me.pending.delete(id)) resolve({ error: 'timed out' });
      }, timeout);
      t.unref?.();
    });
    me.child.stdin.write(`${JSON.stringify({ ...msg, id })}\n`);
    const out = await answer;
    lastUse = now();
    return out;
  }

  return {
    request,
    /** off | starting | ready */
    state: () => (w ? w.state : 'off'),
    loading: () => loading,
    error: () => lastError,
    running: () => Boolean(w),
    /** Start loading now (the page opened), without waiting for it. */
    warm: () => {
      lastUse = now();
      void start();
    },
    stop,
    close() {
      clearInterval(idleTimer);
      stop();
    },
  };
}

/** The size the live preview works at (pix2pix-turbo was trained at 512 × 512). */
export const LIVE_DRAW_SIZE = 512;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export const MAX_SKETCH_BYTES = 4 * 1024 * 1024;

/** "Follow my lines" 0..1 → pix2pix-turbo's r (sketch interpolation): 0.25 loose … 0.85 close (its demo uses 0.4). */
export const followToR = (follow) => {
  const f = Math.min(1, Math.max(0, Number.isFinite(Number(follow)) ? Number(follow) : 0.5));
  return Math.round((0.25 + 0.6 * f) * 100) / 100;
};

/** A sketch from the page: a PNG as a data URL, base64, or bytes. Returns the PNG bytes or throws a 400. */
export function sketchBytes(image) {
  let buf = null;
  if (Buffer.isBuffer(image)) buf = image;
  else if (typeof image === 'string') {
    const m = /^(?:data:image\/png;base64,)?([A-Za-z0-9+/=\s]+)$/.exec(image);
    if (m) buf = Buffer.from(m[1], 'base64');
  }
  const bad = (message, status = 400) => Object.assign(new Error(message), { status });
  if (!buf || buf.length < 24) throw bad('The drawing must be a PNG picture.');
  if (buf.length > MAX_SKETCH_BYTES) throw bad('The drawing is too large.', 413);
  if (!buf.subarray(0, 8).equals(PNG)) throw bad('The drawing must be a PNG picture.');
  return buf;
}

/**
 * Live draw: a drawing and a few words become a picture in about a frame's time.
 * o: {
 *   worker     createLiveWorker(...) running live_draw_worker.py
 *   installed  async () => boolean (the maker's files are on the machine)
 *   makeRoom   async () => void: hand the graphics card over (chat models out, ComfyUI freed if idle)
 *   paused     () => string | null: why previews wait right now (a video is being made)
 *   activity   () => void: someone is using the machine (resets the auto-off timer)
 *   now, log
 * }
 * Only the newest drawing matters: while one is being made, a newer one replaces any waiting one
 * (which answers { dropped: true }), so a slow frame never builds a queue.
 */
export function createLiveDraw(o) {
  const now = o.now || Date.now;
  let inflight = null; // Promise
  let waiting = null; // { req, resolve }
  let lastMs = null;
  let lastFrameAt = 0;
  let roomMade = false;

  function bad(message, status = 400, extra = {}) {
    return Object.assign(new Error(message), { status, ...extra });
  }

  async function render(req) {
    // The graphics card is handed over each time the worker (re)starts, not on every stroke.
    if (!roomMade || !o.worker.running()) {
      roomMade = true;
      await o.makeRoom?.().catch(() => {});
    }
    const t0 = now();
    const out = await o.worker.request({ op: 'frame', prompt: req.prompt, r: req.r, seed: req.seed, image: req.png.toString('base64') });
    if (out.error) throw bad(out.error === 'stopped' ? 'Live draw was paused.' : `Live draw hit a problem: ${out.error}`, 503);
    if (typeof out.jpeg !== 'string') throw bad('Live draw sent nothing back.', 502);
    lastMs = Number(out.ms) || now() - t0;
    lastFrameAt = now();
    return { jpeg: Buffer.from(out.jpeg, 'base64'), ms: lastMs };
  }

  async function pump(first) {
    let job = first;
    while (job) {
      const { req, resolve, reject } = job;
      inflight = render(req);
      try {
        resolve(await inflight);
      } catch (err) {
        reject(err);
      }
      job = waiting;
      waiting = null;
    }
    inflight = null;
  }

  return {
    /**
     * One preview: { prompt, follow (0..1), seed, image (PNG) } → { jpeg, ms } or { dropped: true }.
     * Throws errors with .status (400 bad drawing, 422 blocked words, 409 paused, 503 not installed).
     */
    async frame({ prompt, follow, seed, image }) {
      const words = String(prompt || '').trim().slice(0, 500);
      if (blockedPrompt(words)) throw bad(BLOCKED_MESSAGE, 422, { blocked: true });
      const png = sketchBytes(image);
      if (!(await o.installed())) throw bad('Live draw is not installed. Add it in the Store (Makers).', 503);
      const why = o.paused?.();
      if (why) throw bad(why, 409, { paused: true });
      o.activity?.();
      const req = { prompt: words || 'a picture', r: followToR(follow), seed: Number.isInteger(seed) && seed >= 0 ? seed % 2 ** 31 : 42, png };
      return new Promise((resolve, reject) => {
        const job = { req, resolve, reject };
        if (!inflight) {
          void pump(job);
          return;
        }
        waiting?.resolve({ dropped: true });
        waiting = job;
      });
    },
    /** Rendering a preview right now (counts as a job for the auto-off timer). */
    busy: () => Boolean(inflight),
    state: async () => ({
      installed: await o.installed().catch(() => false),
      worker: o.worker.state(),
      loading: o.worker.loading(),
      error: o.worker.error(),
      lastMs,
      lastFrameAt: lastFrameAt ? new Date(lastFrameAt).toISOString() : null,
      paused: o.paused?.() || null,
    }),
    /** The page opened: start loading the model so the first stroke doesn't wait (only when installed and not paused). */
    async warm() {
      if (o.worker.running() || o.paused?.() || !(await o.installed().catch(() => false))) return;
      roomMade = true;
      await o.makeRoom?.().catch(() => {});
      o.worker.warm();
    },
    /** Give the graphics card back now (a video job needs it). */
    release() {
      roomMade = false;
      o.worker.stop();
    },
  };
}
