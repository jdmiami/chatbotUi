// Live video: the iPad's camera (or a drawing) streamed to the AI machine and restyled by a prompt you
// can change while it runs, frames streamed back; or, with Krea Realtime, a video made from words as
// it plays. Two makers, each in its own Python (their PyTorch differs from ComfyUI's):
//
//   StreamDiffusionV2 (1.3B, Apache-2.0)   a long-lived worker (live_video_worker.py) speaking JSON
//                                          lines, like Live draw's (live.js)
//   Krea Realtime 14B (code CC BY-NC-SA)   Krea's own server (release_server.py, uvicorn on
//                                          127.0.0.1 only), reached over its msgpack WebSocket
//
// Orbit talks to the gate only (/_orbit/live/video, a WebSocket, behind the gate's sign-in); the
// gate keeps the last 10 seconds of returned frames so "Save last 10 s" can join them into a video
// with ffmpeg and put it in the gallery.
import { spawn as nodeSpawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { BLOCKED_MESSAGE, PHOTO_MESSAGE, blockedForPhoto, blockedPrompt } from './studio.js';
import { packb, unpackb } from './msgpack.js';

const SECRETS = ['GATEWAY_SECRET', 'RUNPOD_API_KEY', 'STUDIO_KEY', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'HF_TOKEN', 'HUGGING_FACE_HUB_TOKEN'];
const cleanEnv = (extra = {}, keep = []) => {
  const env = { ...process.env, ...extra };
  for (const k of SECRETS) if (!keep.includes(k)) delete env[k];
  return env;
};
const bad = (message, status = 400, extra = {}) => Object.assign(new Error(message), { status, ...extra });

/** Krea Realtime needs 40 GB+ of GPU memory: only the Turbo machine (H100 80 GB) has room. */
export const TURBO_GPU_BYTES = 70e9;
export const TURBO_MESSAGE = 'Krea Realtime 14B needs the Turbo machine (H100, 80 GB): it does not fit the Standard machine’s 48 GB. Turn the AI machine off, pick Turbo, and turn it on again.';
/** How much of the stream "Save last 10 s" keeps. */
export const SAVE_SECONDS = 10;

// ---------------------------------------------------------------- their Python environments

/**
 * The Python each live video maker runs in, set up once by ai/live_env.sh (code at a pinned commit and
 * its own packages), kept in R2 when there is no volume.
 * o: { dir (STUDIO_DIR), script (live_env.sh), spawn, log, node }
 */
export function createLiveEnvs(o) {
  const run = o.spawn || nodeSpawn;
  const log = o.log || console;
  const jobs = new Map(); // name -> { running, error, line }
  const root = path.join(o.dir, 'live-env');
  const ready = (name) => fs.existsSync(path.join(root, name, '.installed'));
  return {
    root,
    ready,
    /** Start setting it up (no-op when ready or already running). */
    ensure(name) {
      if (ready(name) || jobs.get(name)?.running) return;
      const job = { running: true, error: null, line: 'Starting' };
      jobs.set(name, job);
      const child = run('bash', [o.script, name], { stdio: ['ignore', 'pipe', 'pipe'], // It keeps the environment in R2 (r2cli.js needs the R2 keys, as studio.sh does); never the gate's own secrets.
        env: cleanEnv({ STUDIO_DIR: o.dir, ...(o.node ? { NODE: o.node } : {}) }, ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']) });
      const lines = (s) => readline.createInterface({ input: s }).on('line', (l) => {
        job.line = l.replace(/^\[live-env \w+\]\s*/, '').slice(0, 200);
        log.info?.(`[live-env ${name}] ${job.line}`);
      });
      if (child.stdout) lines(child.stdout);
      if (child.stderr) lines(child.stderr);
      child.on('error', (err) => {
        job.running = false;
        job.error = err.message;
      });
      child.on('exit', (code) => {
        job.running = false;
        if (code !== 0 || !ready(name)) job.error = `Setting up its Python failed (${job.line || `exit ${code}`}). It tries again at the next start, or remove and add it.`;
        else job.error = null;
      });
    },
    state(name) {
      const j = jobs.get(name);
      return { ready: ready(name), installing: Boolean(j?.running), step: j?.running ? j.line : null, error: j?.error || null };
    },
    busy: () => [...jobs.values()].some((j) => j.running),
    async remove(name) {
      await fsp.rm(path.join(root, name), { recursive: true, force: true });
      jobs.delete(name);
    },
  };
}

// ---------------------------------------------------------------- Krea's own server

/**
 * A local HTTP/WebSocket server process (Krea's release_server.py under uvicorn on 127.0.0.1),
 * started on demand and stopped after `idleMs` with no session.
 * o: { name, cmd, args, cwd, env, url (http://127.0.0.1:port), spawn, fetchImpl, startTimeoutMs, idleMs, log, prepare }
 */
export function createLiveServer(o) {
  const run = o.spawn || nodeSpawn;
  const f = o.fetchImpl || fetch;
  const log = o.log || console;
  let child = null;
  let starting = null;
  let users = 0;
  let quietSince = Date.now();
  let lastError = null;
  let tail = '';

  const healthy = () => f(`${o.url}/health`, { signal: AbortSignal.timeout(3000) }).then((r) => r.ok, () => false);
  async function start() {
    if (child && !starting) return true;
    if (starting) return starting;
    starting = (async () => {
      await o.prepare?.();
      tail = '';
      const c = run(o.cmd, o.args, { cwd: o.cwd, stdio: ['ignore', 'pipe', 'pipe'], env: cleanEnv(o.env) });
      child = c;
      const keep = (d) => (tail = (tail + d).slice(-2000));
      c.stdout?.on('data', keep);
      c.stderr?.on('data', keep);
      let exited = false;
      c.on('exit', (code) => {
        exited = true;
        if (child === c) child = null;
        lastError = `${o.name} stopped (exit ${code})${tail ? `: ${tail.trim().split('\n').pop().slice(0, 300)}` : ''}`;
        log.warn?.(`[live] ${lastError}`);
      });
      c.on('error', (err) => {
        exited = true;
        if (child === c) child = null;
        lastError = `${o.name} could not start: ${err.message}`;
      });
      const until = Date.now() + (o.startTimeoutMs ?? 15 * 60_000);
      while (Date.now() < until && !exited) {
        if (await healthy()) {
          lastError = null;
          return true;
        }
        await new Promise((r) => setTimeout(r, o.pollMs ?? 2000));
      }
      if (!exited) {
        lastError = `${o.name} took too long to load.`;
        c.kill('SIGTERM');
      }
      return false;
    })().finally(() => {
      starting = null;
    });
    return starting;
  }
  const stop = () => {
    const c = child;
    child = null;
    c?.kill('SIGTERM');
  };
  const t = setInterval(() => {
    if (child && !starting && users === 0 && Date.now() - quietSince > (o.idleMs ?? 5 * 60_000)) {
      log.info?.(`[live] ${o.name}: unused, unloading it`);
      stop();
    }
  }, Math.min(30_000, Math.max(500, Math.floor((o.idleMs ?? 5 * 60_000) / 4))));
  t.unref?.();
  return {
    start,
    stop,
    running: () => Boolean(child) && !starting,
    starting: () => Boolean(starting),
    error: () => lastError,
    hold() {
      users++;
    },
    release() {
      users = Math.max(0, users - 1);
      quietSince = Date.now();
    },
    close() {
      clearInterval(t);
      stop();
    },
  };
}

// ---------------------------------------------------------------- the sessions

/** A data URL or base64 JPEG/PNG frame from the page → bytes (or null). */
export function frameBytes(image) {
  if (typeof image !== 'string') return null;
  const m = /^(?:data:image\/(?:jpeg|png|webp);base64,)?([A-Za-z0-9+/=]+)$/.exec(image);
  if (!m) return null;
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length < 4 || buf.length > 2 * 1024 * 1024) return null;
  const jpeg = buf[0] === 0xff && buf[1] === 0xd8;
  const png = buf[0] === 0x89 && buf[1] === 0x50;
  const webp = buf.length > 12 && buf.toString('ascii', 8, 12) === 'WEBP';
  return jpeg || png || webp ? buf : null;
}

/** Frames per second of a list of { at } (ms), for joining them into a video. */
export function measuredFps(frames) {
  if (frames.length < 2) return 8;
  const span = (frames.at(-1).at - frames[0].at) / 1000;
  return Math.min(30, Math.max(1, Math.round(((frames.length - 1) / Math.max(0.1, span)) * 10) / 10));
}

/**
 * o: {
 *   studio        studio.js (makerInstalled, makeRoom, videoInFlight, addItem, dir)
 *   envs          createLiveEnvs
 *   sdv2Worker    () => createLiveWorker(...) for live_video_worker.py (made once, reused)
 *   krea          createLiveServer(...) for Krea's server; kreaUrl: its ws:// base
 *   gpuMemory     async () => bytes of GPU memory on this machine (0 when unknown)
 *   makeWay       async () => void: Live draw lets go of the graphics card
 *   activity      () => void
 *   ffmpeg        async (args) => void
 *   WebSocketImpl (tests)
 *   now, log
 * }
 */
export function createLiveVideo(o) {
  const now = o.now || Date.now;
  const log = o.log || console;
  const WS = o.WebSocketImpl || globalThis.WebSocket;
  let current = null; // the one live session on this machine
  let sdv2 = null;

  /** Open one page's connection. send(msg) delivers to the page. Returns { message(msg), close() }. */
  function open(send) {
    const s = {
      send,
      maker: null,
      source: null,
      prompt: '',
      strength: 0.7,
      running: false,
      frames: [], // frames sent back, the last SAVE_SECONDS: { at, jpeg }
      pending: [], // frames from the page waiting for the maker
      inflight: false,
      krea: null, // its WebSocket
      startedAt: 0,
      ended: false,
    };

    const fail = (err) => send({ type: 'error', status: err.status || 500, error: err.message, blocked: Boolean(err.blocked) });
    const deliver = (jpeg, ms) => {
      const at = now();
      s.frames.push({ at, jpeg });
      while (s.frames.length && at - s.frames[0].at > SAVE_SECONDS * 1000) s.frames.shift();
      send({ type: 'frame', image: `data:image/jpeg;base64,${jpeg.toString('base64')}`, ms: ms ?? null });
    };

    function checkWords(words) {
      if (blockedPrompt(words)) throw bad(BLOCKED_MESSAGE, 422, { blocked: true });
      // The camera shows real people: the photo rule (nothing sexual, no undressing) holds for it.
      if (s.source === 'camera' && blockedForPhoto(words)) throw bad(PHOTO_MESSAGE, 422, { blocked: true });
    }

    async function start(msg) {
      const maker = msg.maker === 'live-krea' ? 'live-krea' : 'live-sdv2';
      const source = ['camera', 'canvas', 'text'].includes(msg.source) ? msg.source : 'camera';
      if (maker === 'live-sdv2' && source === 'text') throw bad('StreamDiffusionV2 restyles your camera or your drawing. Making video from words alone is Krea Realtime’s.');
      s.maker = maker;
      s.source = source;
      s.prompt = String(msg.prompt || '').trim().slice(0, 500);
      s.strength = Math.min(0.95, Math.max(0.3, Number(msg.strength) || 0.7));
      if (!s.prompt) throw bad('Describe the look, e.g. “a watercolour painting”.');
      checkWords(s.prompt);
      if (!(await o.studio.makerInstalled(maker))) throw bad(`${maker === 'live-krea' ? 'Krea Realtime' : 'StreamDiffusionV2'} is not installed. Add it in the Store (Makers).`, 503);
      if (maker === 'live-krea' && (await o.gpuMemory()) < TURBO_GPU_BYTES) throw bad(TURBO_MESSAGE, 409, { turbo: true });
      if (o.studio.videoInFlight()) throw bad('Your AI machine is making a video: live video can start when it is done.', 409);
      // One live stream per machine: a newer one takes over.
      if (current && current !== s) {
        current.send({ type: 'error', status: 409, error: 'Live video was started on another screen.' });
        current.stop();
      }
      current = s;
      await o.makeWay?.().catch(() => {});
      await o.studio.makeRoom().catch(() => {});
      o.activity?.();
      s.running = true;
      s.startedAt = now();
      s.frames = [];
      s.pending = [];
      send({ type: 'state', state: 'loading', maker, source });
      if (maker === 'live-sdv2') {
        sdv2 ||= o.sdv2Worker();
        // Loads the model (or answers that it can't).
        const r = await sdv2.request({ op: 'reset' }, { timeout: 15 * 60_000 });
        if (r.error) throw bad(`StreamDiffusionV2 could not start: ${r.error}`, 503);
        if (s.running) send({ type: 'state', state: 'live', maker, source });
      } else {
        await startKrea();
      }
    }

    async function startKrea() {
      o.krea.hold();
      if (!(await o.krea.start())) throw bad(`Krea Realtime could not start: ${o.krea.error() || 'unknown problem'}`, 503);
      if (!s.running) return;
      const ws = new WS(`${o.kreaUrl}/session/${crypto.randomUUID()}?fmt=jpeg`);
      ws.binaryType = 'arraybuffer';
      s.krea = ws;
      await new Promise((resolve, reject) => {
        ws.onopen = resolve;
        ws.onerror = () => reject(bad('Could not reach Krea Realtime on the AI machine.', 503));
      });
      ws.onmessage = (ev) => {
        if (typeof ev.data === 'string') {
          let m;
          try {
            m = JSON.parse(ev.data);
          } catch {
            return;
          }
          if (m.status === 'ready') {
            // Words alone: a video from the prompt; camera or canvas: their frames, restyled.
            ws.send(
              packb({
                prompt: s.prompt,
                width: s.source === 'text' ? 832 : 512,
                height: s.source === 'text' ? 480 : 512,
                num_blocks: 100000,
                num_denoising_steps: 4,
                kv_cache_num_frames: 3,
                webcam_mode: s.source !== 'text',
                webcam_fps: 8,
                strength: s.strength,
              }),
            );
            send({ type: 'state', state: 'live', maker: s.maker, source: s.source });
          } else if (m.error) send({ type: 'error', status: 502, error: `Krea Realtime: ${JSON.stringify(m.error).slice(0, 200)}` });
          else if (m.status === 'completed' && s.running) send({ type: 'state', state: 'stopped' });
          return;
        }
        deliver(Buffer.from(ev.data));
      };
      ws.onclose = () => {
        if (s.krea === ws) s.krea = null;
        if (s.running) {
          s.running = false;
          send({ type: 'state', state: 'stopped' });
        }
      };
    }

    async function pumpSdv2() {
      if (s.inflight || !s.pending.length || !sdv2) return;
      s.inflight = true;
      try {
        while (s.running && s.pending.length) {
          const batch = s.pending.splice(0);
          const r = await sdv2.request({ op: 'frames', prompt: s.prompt, strength: s.strength, frames: batch.map((b) => b.toString('base64')) }, { timeout: 120_000 });
          if (!s.running) break;
          if (r.error) {
            send({ type: 'error', status: 503, error: `StreamDiffusionV2 hit a problem: ${r.error}` });
            continue;
          }
          const ms = r.frames?.length ? Math.round(r.ms / r.frames.length) : null;
          for (const f of r.frames || []) deliver(Buffer.from(f, 'base64'), ms);
          if (r.frames?.length) o.activity?.();
        }
      } finally {
        s.inflight = false;
      }
    }

    function frame(msg) {
      if (!s.running || s.source === 'text') return;
      const buf = frameBytes(msg.image);
      if (!buf) return send({ type: 'error', status: 400, error: 'That frame is not a picture.' });
      if (s.maker === 'live-sdv2') {
        s.pending.push(buf);
        // Never more than about a second behind: the oldest frames go.
        while (s.pending.length > 12) s.pending.shift();
        void pumpSdv2();
      } else if (s.krea?.readyState === 1) {
        s.krea.send(packb({ image: buf, strength: s.strength, timestamp: now() }));
      }
    }

    function prompt(msg) {
      const words = String(msg.prompt || '').trim().slice(0, 500);
      if (!words || words === s.prompt) return;
      checkWords(words);
      s.prompt = words;
      o.activity?.();
      // StreamDiffusionV2 starts a new session with the next frames; Krea blends to the new prompt.
      if (s.krea?.readyState === 1) s.krea.send(packb({ prompt: words }));
      send({ type: 'prompt', prompt: words });
    }

    s.stop = () => {
      if (!s.running && !s.krea) return;
      s.running = false;
      s.pending = [];
      if (s.krea) {
        try {
          s.krea.close();
        } catch {
          /* gone */
        }
        s.krea = null;
        o.krea.release();
      }
      if (current === s) current = null;
    };

    async function save() {
      const frames = s.frames.slice();
      if (frames.length < 2) throw bad('There is nothing to save yet: start live video first.');
      const fps = measuredFps(frames);
      const id = `live-${crypto.randomBytes(6).toString('base64url')}`;
      const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'live-'));
      const rel = `orbit/${id}.mp4`;
      const out = path.join(o.studio.dir, 'output', rel);
      try {
        for (const [i, fr] of frames.entries()) await fsp.writeFile(path.join(tmp, `${String(i).padStart(5, '0')}.jpg`), fr.jpeg);
        await fsp.mkdir(path.dirname(out), { recursive: true });
        await o.ffmpeg(['-hide_banner', '-loglevel', 'error', '-y', '-framerate', String(fps), '-i', path.join(tmp, '%05d.jpg'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-movflags', '+faststart', out], { timeoutMs: 120_000 });
      } finally {
        await fsp.rm(tmp, { recursive: true, force: true });
      }
      const seconds = Math.round(((frames.length / fps) * 10)) / 10;
      return o.studio.addItem({ kind: 'video', maker: s.maker, prompt: s.prompt, file: rel, seconds, photo: s.source === 'camera' });
    }

    return {
      async message(msg) {
        try {
          if (msg.type === 'start') return await start(msg);
          if (msg.type === 'frame') return frame(msg);
          if (msg.type === 'prompt') return prompt(msg);
          if (msg.type === 'strength') {
            s.strength = Math.min(0.95, Math.max(0.3, Number(msg.strength) || s.strength));
            return undefined;
          }
          if (msg.type === 'stop') {
            s.stop();
            return send({ type: 'state', state: 'stopped' });
          }
          if (msg.type === 'save') {
            const item = await save();
            return send({ type: 'saved', item });
          }
          return send({ type: 'error', status: 400, error: 'Unknown message.' });
        } catch (err) {
          if (msg.type === 'start') s.stop();
          log.warn?.(`[live] ${err.message}`);
          return fail(err);
        }
      },
      close() {
        s.ended = true;
        s.stop();
      },
      /** Tests. */
      session: s,
    };
  }

  return {
    open,
    /** A stream is making frames (counts as use for the auto-off timer while frames come back). */
    busy: () => Boolean(current?.running && current.frames.length && now() - current.frames.at(-1).at < 30_000),
    state: () => (current ? { running: current.running, maker: current.maker, source: current.source } : { running: false }),
    /** A video job needs the whole graphics card. */
    release() {
      if (current) {
        current.send({ type: 'error', status: 409, error: 'Your AI machine started making a video: live video stopped.' });
        current.stop();
      }
      sdv2?.stop();
      o.krea?.stop();
    },
  };
}
