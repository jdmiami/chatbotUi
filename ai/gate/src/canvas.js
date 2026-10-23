// Live Draw's engines on the drawing machine (docs/livedraw/DESIGN.md §2 and §5): one long-lived
// Python worker (canvas_worker.py, through live.js createLiveWorker) holds both engine sets once used
// ("fast": pix2pix-turbo + SD-Turbo, the owner's; "licensed": SD 1.5 + LCM-LoRA + ControlNet, the
// studio members') and the sketch reader (Florence-2). Finish and Animate are ordinary studio jobs
// (Sketch finish and LTX), so they land in the gallery like everything else.
//
// The gate's routes (gate.js) call into this: the WebSocket /_orbit/canvas/live (and its POST fallback
// /_orbit/canvas/frame), /_orbit/canvas (state), /warm, /read, /finish; and the same under
// /_studio/canvas for studio members, who always get the licensed engine and can't send pictures of
// their own as a style reference.
//
// Animate and Living canvas are live video (livevideo.js) on /_orbit/live/video, started from the
// canvas picture: Krea Realtime 14B for the owner, StreamDiffusionV2 for studio members (Krea's code is
// non-commercial; members use /_studio/canvas/video, which forces it). This file only reports whether
// those makers are ready.
import { BLOCKED_MESSAGE, PHOTO_MESSAGE, blockedForPhoto, blockedPrompt } from './studio.js';

export const ENGINES = ['fast', 'licensed'];
/** How the app names them (the error a fast-only feature gives says "Members engine"). */
export const ENGINE_NAMES = { fast: 'Fast', licensed: 'Members', reader: 'Sketch reader' };
/** The catalog makers whose files each engine loads (catalog.json; the studio downloads them to the drive). */
export const ENGINE_MAKERS = { fast: 'canvas-fast', licensed: 'canvas-licensed', reader: 'canvas-reader' };
export const CANVAS_SIZES = [512, 768, 1024];
export const MAX_REGIONS = 8;
export const MAX_PICTURE_BYTES = 6 * 1024 * 1024;
/** The studio makers behind Finish and Animate (workflows.js / catalog.json). */
export const FINISH_MAKER = 'sketch-finish';
/** Animate's live video maker: Krea Realtime for the owner, StreamDiffusionV2 for studio members. */
export const ANIMATE_MAKERS = { owner: 'live-krea', member: 'live-sdv2' };
export const LIVING_MAKER = 'live-sdv2';

const bad = (message, status = 400, extra = {}) => Object.assign(new Error(message), { status, ...extra });
const clamp = (v, lo, hi, dflt) => {
  const n = Number(v);
  return Number.isFinite(n) && v !== null && v !== '' ? Math.min(hi, Math.max(lo, n)) : dflt;
};

function kindOf(buf) {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

/**
 * A picture from the page (data URL or bare base64) → { b64 (no prefix), kind, dataUrl } or null when
 * absent. Throws a 400/413 naming `what` when it isn't a PNG/JPEG/WebP or is too large.
 */
export function canvasPicture(value, what, { kinds = ['png', 'jpeg', 'webp'], max = MAX_PICTURE_BYTES } = {}) {
  if (value == null || value === '') return null;
  const m = typeof value === 'string' ? /^(?:data:image\/[a-z+]+;base64,)?([A-Za-z0-9+/=\s]+)$/.exec(value) : null;
  if (!m) throw bad(`The ${what} must be a picture.`);
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > max) throw bad(`The ${what} is too large.`, 413);
  const kind = kindOf(buf);
  if (!kind || !kinds.includes(kind)) throw bad(`The ${what} must be a ${kinds.map((k) => k.toUpperCase()).join(' or ')} picture.`);
  const b64 = buf.toString('base64');
  return { b64, kind, dataUrl: `data:image/${kind};base64,${b64}` };
}

/**
 * o: {
 *   makeWorker   (onEvent) => createLiveWorker(...) running canvas_worker.py (onEvent gets its progress lines)
 *   studio       studio.js (makers, state, createJob) for Finish, Animate and Living canvas's state
 *   makeRoom     async () => void, optional: hand the graphics card over (the main machine only)
 *   paused       () => string | null, optional: why frames wait right now (a video on the main machine)
 *   activity     () => void: someone is drawing (resets the auto-off timer)
 *   gpu          async () => { name, memoryGb } | null
 *   finishMaker                 Finish's maker id (default above)
 *   loadTimeoutMs               how long a first load (downloads included) may take
 *   now, log
 * }
 */
export function createCanvas(o) {
  const now = o.now || Date.now;
  const log = o.log || console;
  const finishMaker = o.finishMaker || FINISH_MAKER;
  const loadTimeoutMs = o.loadTimeoutMs ?? 45 * 60_000;
  const slot = () => ({ state: 'off', error: null, loading: null, promise: null, failedAt: 0 });
  const slots = { fast: slot(), licensed: slot(), reader: slot() };
  const listeners = new Set(); // open sockets: state pushes and "run the newest frame once loaded"
  let starting = null; // what the worker says while Python itself starts
  let roomMade = false;
  let lastMs = null;
  let lastFrameAt = 0;
  let reading = 0;
  let lastPush = '';

  const worker = o.makeWorker(onEvent);

  /** A worker that stopped (quiet minutes, a crash) has nothing loaded any more. */
  function sync() {
    if (worker.running()) return;
    for (const s of Object.values(slots)) if (!s.promise && s.state !== 'error') s.state = 'off';
  }

  function onEvent(msg) {
    const s = msg.engine && slots[msg.engine];
    if (s) {
      if (msg.state === 'loading' || msg.state === 'ready' || msg.state === 'error') s.state = msg.state;
      if (msg.state === 'error') s.error = String(msg.error || 'could not load').slice(0, 300);
      if (msg.state === 'ready') s.loading = null;
      if (msg.loading) s.loading = String(msg.loading).slice(0, 200);
    } else if (msg.loading) starting = String(msg.loading).slice(0, 200);
    else if (msg.ready) starting = null;
    notify();
  }

  function engines() {
    sync();
    return { fast: slots.fast.state, licensed: slots.licensed.state };
  }
  function loadingText() {
    for (const k of ['licensed', 'fast', 'reader']) if (slots[k].state === 'loading') return `${ENGINE_NAMES[k]}: ${slots[k].loading || starting || 'Starting'}`;
    return null;
  }
  function stateMessage() {
    const msg = { type: 'state', engines: engines() };
    const text = loadingText();
    if (text) msg.loading = text;
    const errors = Object.fromEntries(ENGINES.filter((k) => slots[k].state === 'error').map((k) => [k, slots[k].error]));
    if (Object.keys(errors).length) msg.errors = errors;
    return msg;
  }
  function notify() {
    const msg = stateMessage();
    const key = JSON.stringify(msg);
    if (key !== lastPush) {
      lastPush = key;
      for (const l of listeners) l.state(msg);
    }
    for (const l of listeners) l.wake();
  }

  /**
   * Wait until the engine's maker has all its files (the drawing machine downloads its makers by itself
   * at start). Resolves null when ready, or the reason it can't be (not installed, a download problem).
   */
  async function filesReady(name) {
    const id = ENGINE_MAKERS[name];
    if (!o.studio || !id) return null;
    const until = now() + loadTimeoutMs;
    for (;;) {
      if (await o.studio.makerInstalled(id)) return null;
      const m = (await o.studio.makers().catch(() => [])).find((x) => x.id === id);
      if (!m || !m.wanted) return `${name === 'reader' ? 'The sketch reader' : `The ${ENGINE_NAMES[name]} engine`} is not installed: add “${m?.name || id}” in the Store (Makers).`;
      if (m.problem) return m.problem;
      slots[name].loading = `Downloading its models (${m.percent || 0}%)`;
      notify();
      if (now() > until) return 'Its models took too long to download.';
      await new Promise((r) => setTimeout(r, o.filesPollMs ?? 3000));
    }
  }

  /** Load an engine (or the reader) and keep it; resolves true when ready. Concurrent calls share one load. */
  function load(name) {
    const s = slots[name];
    sync();
    if (s.state === 'ready' && worker.running()) return Promise.resolve(true);
    if (s.promise) return s.promise;
    s.state = 'loading';
    s.error = null;
    s.loading = null;
    s.promise = (async () => {
      // Its model files come through the studio's catalog (the drive): wait for them first.
      const why = await filesReady(name).catch((err) => err.message);
      if (why) {
        s.state = 'error';
        s.error = why;
        s.failedAt = now();
        return false;
      }
      if (!roomMade || !worker.running()) {
        roomMade = true;
        await o.makeRoom?.().catch(() => {});
      }
      const out = await worker.request({ op: 'load', engine: name }, { timeout: loadTimeoutMs });
      if (out.error) {
        s.state = out.error === 'stopped' ? 'off' : 'error';
        s.error = out.error === 'stopped' ? null : String(out.error).slice(0, 300);
        s.failedAt = now();
        if (s.error) log.warn?.(`[canvas] ${name} engine: ${s.error}`);
        return false;
      }
      s.state = 'ready';
      s.loading = null;
      return true;
    })().finally(() => {
      s.promise = null;
      notify();
    });
    notify();
    return s.promise;
  }

  /**
   * Check a frame from the page and turn it into the worker's request (throws errors with .status;
   * 422 + blocked for the content rules). opts: { engine (forced, members), member }.
   */
  function prepare(msg, opts = {}) {
    if (!msg || typeof msg !== 'object') throw bad('Not a frame.');
    const engine = opts.engine || (ENGINES.includes(msg.engine) ? msg.engine : o.defaultEngine || 'fast');
    const prompt = String(msg.prompt || '').trim().slice(0, 500);
    const regions = Array.isArray(msg.regions) ? msg.regions : [];
    if (regions.length > MAX_REGIONS) throw bad(`At most ${MAX_REGIONS} regions.`);
    const regionWords = regions.map((r) => String(r?.prompt || '').trim().slice(0, 300));
    // The content rules: the words, each region's words, and all of them together.
    if (blockedPrompt(prompt) || regionWords.some((w) => blockedPrompt(w)) || blockedPrompt([prompt, ...regionWords].join(' '))) throw bad(BLOCKED_MESSAGE, 422, { blocked: true });
    if (msg.ref != null && msg.ref !== false) {
      if (opts.member) throw bad('Style references can’t be used here: only your own drawing goes to the drawing machine.', 403);
      // A style reference may be a photo of a real person: the photo rule holds for it.
      if (blockedForPhoto(prompt) || regionWords.some((w) => blockedForPhoto(w))) throw bad(PHOTO_MESSAGE, 422, { blocked: true });
    }
    const sketch = canvasPicture(msg.sketch, 'drawing', { kinds: ['png'] });
    if (!sketch) throw bad('The drawing is missing.');
    const pic = (v, what) => canvasPicture(v, what)?.b64;
    const mode = msg.mode === 'paint' ? 'paint' : 'live';
    const req = {
      engine,
      mode,
      prompt: prompt || 'a picture',
      seed: Number.isInteger(msg.seed) && msg.seed >= 0 ? msg.seed % 2 ** 31 : 42,
      follow: clamp(msg.follow, 0, 1, 0.5),
      strength: clamp(msg.strength, 0, 1, 0.6),
      size: CANVAS_SIZES.includes(Number(msg.size)) ? Number(msg.size) : 512,
      sketch: sketch.b64,
    };
    for (const k of ['color', 'base', 'mask', 'pose']) {
      const v = pic(msg[k], { color: 'colour layer', base: 'kept picture', mask: 'painted area', pose: 'pose' }[k]);
      if (v) req[k] = v;
    }
    if (mode === 'paint' && (!req.base || !req.mask)) throw bad('Paint over needs the picture and the painted area.');
    if (req.mask && !req.base) throw bad('The painted area needs the picture it is painted on.');
    if (regions.length) {
      req.regions = regions.map((r, i) => {
        if (!regionWords[i]) throw bad('Each region needs its own words.');
        const mask = pic(r?.mask, 'region');
        if (!mask) throw bad('A region is missing its shape.');
        return { mask, prompt: regionWords[i] };
      });
    }
    if (msg.ref != null && msg.ref !== false) {
      const image = pic(msg.ref?.image, 'style reference');
      if (!image) throw bad('The style reference picture is missing.');
      req.ref = { image, weight: clamp(msg.ref?.weight, 0, 1.5, 0.6) };
    }
    return req;
  }

  /** One picture from the worker: { image (data URL), ms }. Throws with .status (and .loading while an engine loads). */
  async function render(req) {
    const why = o.paused?.();
    if (why) throw bad(why, 409, { paused: true });
    if (slots[req.engine].state !== 'ready' || !worker.running()) {
      const s = slots[req.engine];
      // An engine that failed to load is tried again after half a minute (or at once with warm), not on every stroke.
      if (!(s.state === 'error' && now() - s.failedAt < 30_000)) void load(req.engine);
      if (s.state === 'error') throw bad(`The ${ENGINE_NAMES[req.engine]} engine could not load: ${s.error}`, 503, { engine: req.engine });
      throw bad(`The ${ENGINE_NAMES[req.engine]} engine is loading (${s.loading || starting || 'starting'}). Your picture appears when it is ready.`, 503, { loading: true, engine: req.engine });
    }
    o.activity?.();
    const t0 = now();
    const out = await worker.request({ op: 'frame', ...req }, { timeout: 60_000 });
    if (out.error) {
      if (out.user) throw bad(out.error, 400);
      if (out.error === 'stopped') throw bad('Live Draw was paused.', 503);
      if (out.error === 'timed out') throw bad('The drawing engine took too long.', 504);
      throw bad(`The drawing engine hit a problem: ${out.error}`, 503);
    }
    if (typeof out.image !== 'string' || !out.image) throw bad('The drawing engine sent nothing back.', 502);
    lastMs = Number(out.ms) || now() - t0;
    lastFrameAt = now();
    return { image: `data:image/webp;base64,${out.image}`, ms: lastMs };
  }

  /** Only the newest frame matters: one in flight, a newer one replaces the waiting one ({ dropped: true }). */
  function newestLane() {
    let inflight = false;
    let waiting = null;
    async function pump(job) {
      inflight = true;
      while (job) {
        try {
          job.resolve(await render(job.req));
        } catch (err) {
          job.reject(err);
        }
        job = waiting;
        waiting = null;
      }
      inflight = false;
    }
    return {
      busy: () => inflight,
      submit(req) {
        return new Promise((resolve, reject) => {
          const job = { req, resolve, reject };
          if (!inflight) return void pump(job);
          waiting?.resolve({ dropped: true });
          waiting = job;
        });
      },
    };
  }
  const lanes = new Set();
  const postLane = newestLane();
  lanes.add(postLane);

  const reply = (id, out) => (out.dropped ? { type: 'dropped', id } : { type: 'frame', id, image: out.image, ms: out.ms });
  /** An error as a CanvasReply (DESIGN.md §5.1). */
  function errorReply(id, err) {
    const status = err.status || (err instanceof SyntaxError ? 400 : 500);
    const out = { type: 'error', id, error: err.message, status };
    if (err.blocked) out.blocked = true;
    if (err.paused) out.paused = true;
    if (err.loading) out.loading = true;
    return out;
  }

  /** The finished picture's shape: square unless the app asks for portrait or landscape. */
  const shape = (size) => (['square', 'portrait', 'landscape'].includes(size) ? size : 'square');

  return {
    engines,
    /** The worker's progress lines (tests feed these by hand). */
    event: onEvent,

    /** opts.member: a studio member's view (Animate is StreamDiffusionV2 for them). */
    async state(opts = {}) {
      sync();
      const [makers, studioState, gpu] = await Promise.all([
        o.studio?.makers().catch(() => []) ?? [],
        o.studio?.state().catch(() => null) ?? null,
        o.gpu ? o.gpu().catch(() => null) : null,
      ]);
      const detail = {};
      const makerState = (key, id, needsComfy) => {
        const m = (makers || []).find((x) => x.id === id);
        if (!m) return 'off';
        if (m.problem) {
          detail[key] = m.problem;
          return 'error';
        }
        if (!m.installed) {
          if (!m.wanted) return 'off';
          detail[key] = `${m.status === 'setup' ? 'Setting up' : 'Downloading'} (${m.percent}%)`;
          return 'loading';
        }
        if (needsComfy && !studioState?.running) {
          detail[key] = 'The image and video maker is starting';
          return 'loading';
        }
        return 'ready';
      };
      const out = {
        engines: engines(),
        living: makerState('living', LIVING_MAKER, false),
        animate: makerState('animate', opts.member ? ANIMATE_MAKERS.member : ANIMATE_MAKERS.owner, false),
        finish: makerState('finish', finishMaker, true),
        reader: slots.reader.state === 'off' && !worker.running() ? 'off' : slots.reader.state,
        gpu: gpu || null,
        lastMs,
        lastFrameAt: lastFrameAt ? new Date(lastFrameAt).toISOString() : null,
        paused: o.paused?.() || null,
      };
      const text = loadingText();
      if (text) out.loading = text;
      for (const k of ENGINES) if (slots[k].state === 'error') detail[k] = slots[k].error;
      if (Object.keys(detail).length) out.detail = detail;
      return out;
    },

    /** Start loading an engine (the page opened, or the engine was switched) without waiting. */
    warm(engine) {
      if (!ENGINES.includes(engine)) throw bad('Unknown engine.');
      const why = o.paused?.();
      if (why) return { ok: false, paused: why };
      void load(engine);
      return { ok: true };
    },

    /** One frame without a socket (the POST fallback): { image, ms } or { dropped: true }. */
    async frame(msg, opts = {}) {
      return postLane.submit(prepare(msg, opts));
    },
    reply,
    errorReply,

    /**
     * One page's socket. send(msg) delivers a CanvasReply. opts: { engine (forced), member }.
     * Returns { message(msg), close() }.
     */
    open(send, opts = {}) {
      const lane = newestLane();
      let parked = null; // the newest frame refused while its engine loaded: run when it is ready
      const me = {
        state: (msg) => send(msg),
        wake() {
          if (!parked || slots[parked.req.engine].state !== 'ready') return;
          const { id, req } = parked;
          parked = null;
          void run(id, req);
        },
      };
      listeners.add(me);
      lanes.add(lane);
      async function run(id, req) {
        try {
          const out = await lane.submit(req);
          send(reply(id, out));
        } catch (err) {
          if (err.loading) parked = { id, req };
          send(errorReply(id, err));
        }
      }
      send(stateMessage());
      return {
        async message(msg) {
          const id = msg?.id ?? null;
          try {
            if (msg?.type === 'state') return send(stateMessage());
            if (msg?.type === 'warm') {
              const engine = opts.engine || msg.engine;
              if (!ENGINES.includes(engine)) throw bad('Unknown engine.');
              if (!o.paused?.()) void load(engine);
              return send(stateMessage());
            }
            if (msg?.type !== 'frame') return send({ type: 'error', id, status: 400, error: 'Unknown message.' });
            const req = prepare(msg, opts);
            parked = null;
            return await run(id, req);
          } catch (err) {
            return send(errorReply(id, err));
          }
        },
        close() {
          parked = null;
          listeners.delete(me);
          lanes.delete(lane);
        },
      };
    },

    /** The sketch reader: up to 3 { label, prompt } guesses of what the drawing is. */
    async read(image) {
      const pic = canvasPicture(image, 'drawing');
      if (!pic) throw bad('The drawing is missing.');
      const why = o.paused?.();
      if (why) throw bad(why, 409, { paused: true });
      o.activity?.();
      reading++;
      try {
        // Florence-2 loads on the first read (its files come with the canvas-reader maker), then stays.
        if (!(await load('reader'))) throw bad(`The sketch reader could not load: ${slots.reader.error || 'it stopped'}`, 503);
        const out = await worker.request({ op: 'read', image: pic.b64 }, { timeout: 120_000 });
        if (out.error) {
          slots.reader.state = out.error === 'stopped' ? 'off' : slots.reader.state === 'ready' ? 'ready' : 'error';
          slots.reader.error = out.error;
          throw bad(out.user ? out.error : `The sketch reader hit a problem: ${out.error}`, out.user ? 400 : 503);
        }
        slots.reader.state = 'ready';
        const guesses = (Array.isArray(out.guesses) ? out.guesses : [])
          .map((g) => ({ label: String(g?.label || '').trim().slice(0, 60), prompt: String(g?.prompt || '').trim().slice(0, 300) }))
          .filter((g) => g.label && g.prompt && !blockedPrompt(g.prompt) && !blockedPrompt(g.label))
          .slice(0, 3);
        return { guesses };
      } finally {
        reading--;
        notify();
      }
    },

    /**
     * Finish: a full-quality picture in the gallery (Sketch finish: Z-Image + ControlNet). The canvas as it
     * looks is where it starts from, the sketch's lines are followed. Returns the studio job.
     * body: { image, sketch, prompt, engine, size, follow?, strength? }; opts: { owner }.
     */
    async finish(body = {}, opts = {}) {
      if (!o.studio) throw bad('Finish needs the image maker on this machine.', 503);
      const sketch = canvasPicture(body.sketch, 'drawing', { kinds: ['png'], max: 20 * 1024 * 1024 });
      if (!sketch) throw bad('Draw something first.');
      const image = canvasPicture(body.image, 'picture', { max: 20 * 1024 * 1024 });
      o.activity?.();
      return o.studio.createJob({
        kind: 'image',
        maker: finishMaker,
        prompt: String(body.prompt || '').trim(),
        image: sketch.dataUrl,
        ...(image ? { images: [image.dataUrl] } : {}),
        size: shape(body.size),
        follow: clamp(body.follow, 0, 1, 0.6),
        ...(image ? { startStrength: clamp(body.strength, 0.3, 1, 0.7) } : {}),
        ...(opts.owner ? { owner: opts.owner } : {}),
      });
    },

    /** Making a picture or loading an engine (counts as a job for the auto-off timer). */
    busy: () => [...lanes].some((l) => l.busy()) || reading > 0 || Object.values(slots).some((s) => s.promise),
    /** Give the graphics card back now (a video on the main machine needs it). */
    release() {
      roomMade = false;
      worker.stop();
      sync();
      notify();
    },
    close() {
      worker.close();
    },
  };
}
