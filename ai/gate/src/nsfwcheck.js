// The NSFW check: looks at a picture (or a few frames of a video) and says whether it is NSFW, so
// Orbit can blur it whatever words it was made from. A small image classifier
// (Falconsai/nsfw_image_detection) runs on the CPU in the studio's own Python, in one long-lived
// worker (nsfw_worker.py), so it never competes with the makers for the graphics card.
//
// Never throws: when the worker can't run (no Python yet, no model, a crash) a check answers null,
// "not checked", and Orbit falls back to the words.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

/** At or above this the picture is NSFW. Low on purpose: a picture blurred by mistake costs a hold, one missed costs more. */
export const NSFW_THRESHOLD = 0.35;

/** Seconds into a clip to look at: the start, quarters and the end, so a short NSFW moment isn't missed. */
export function frameTimes(seconds) {
  const s = Math.max(1, Number(seconds) || 5);
  return [0.3, s * 0.25, s * 0.5, s * 0.75, Math.max(0.5, s - 0.4)].map((t) => Math.round(t * 10) / 10);
}

/**
 * o: {
 *   python   the studio's Python (with transformers and Pillow, as ComfyUI installs them)
 *   script   path to nsfw_worker.py
 *   env      extra environment (HF_HOME for the model's cache)
 *   spawn    child_process.spawn (tests pass a fake worker)
 *   ffmpeg   async (args) => void, to pull frames from a video
 *   timeoutMs  per check
 * }
 */
export function createNsfwCheck(o) {
  const { python, script, log = console, timeoutMs = 120_000 } = o;
  const run = o.spawn || spawn;
  let worker = null; // { child, ready: Promise, pending: Map }
  let seq = 0;
  let disabledUntil = 0;

  function start() {
    if (worker) return worker;
    if (!python || !fs.existsSync(python) || !script || !fs.existsSync(script)) return null;
    if (Date.now() < disabledUntil) return null;
    const child = run('nice', ['-n', '10', python, script], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...(o.env || {}) } });
    const pending = new Map();
    let markReady;
    const ready = new Promise((resolve) => (markReady = resolve));
    const w = { child, ready, pending };
    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      if (msg.ready) return markReady(true);
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      p(msg);
    });
    let errTail = '';
    child.stderr?.on('data', (d) => (errTail = (errTail + d).slice(-500)));
    const gone = (why) => {
      if (worker !== w) return;
      worker = null;
      markReady(false);
      for (const p of pending.values()) p({ error: why });
      pending.clear();
      // Crashed (no model, no transformers): leave it for ten minutes rather than retrying on every picture.
      disabledUntil = Date.now() + 10 * 60_000;
      log.warn?.(`[nsfw] the checker stopped: ${why}${errTail ? ` (${errTail.trim().split('\n').pop()})` : ''}`);
    };
    child.on('error', (err) => gone(err.message));
    child.on('exit', (code) => gone(`exited ${code}`));
    worker = w;
    return w;
  }

  async function score(paths) {
    const w = start();
    if (!w || !(await w.ready)) return null;
    const id = `c${++seq}`;
    const answer = new Promise((resolve) => {
      w.pending.set(id, resolve);
      setTimeout(() => {
        if (w.pending.delete(id)) resolve({ error: 'timed out' });
      }, timeoutMs).unref?.();
    });
    w.child.stdin.write(`${JSON.stringify({ id, paths })}\n`);
    const msg = await answer;
    return typeof msg.score === 'number' ? msg.score : null;
  }

  /** Frames of a video as JPEGs in a temp folder (removed by the caller). */
  async function frames(file, seconds) {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'nsfw-'));
    const out = [];
    for (const [i, t] of frameTimes(seconds).entries()) {
      const p = path.join(tmp, `${i}.jpg`);
      try {
        await o.ffmpeg(['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', 'scale=512:-2', p]);
        if (fs.existsSync(p)) out.push(p);
      } catch {
        /* past the end of a short clip */
      }
    }
    return { tmp, paths: out };
  }

  return {
    /** { nsfw, score } for a picture or video on disk, or null when it couldn't be checked. */
    async check(file, { kind = 'image', seconds } = {}) {
      try {
        if (kind !== 'video') {
          const s = await score([file]);
          return s == null ? null : { nsfw: s >= NSFW_THRESHOLD, score: Math.round(s * 1000) / 1000 };
        }
        const { tmp, paths } = await frames(file, seconds);
        try {
          if (!paths.length) return null;
          const s = await score(paths);
          return s == null ? null : { nsfw: s >= NSFW_THRESHOLD, score: Math.round(s * 1000) / 1000 };
        } finally {
          await fsp.rm(tmp, { recursive: true, force: true });
        }
      } catch (err) {
        log.warn?.(`[nsfw] could not check ${path.basename(file)}: ${err.message}`);
        return null;
      }
    },
    stop() {
      worker?.child.kill();
      worker = null;
    },
  };
}
