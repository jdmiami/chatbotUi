// Gallery thumbnails: a small WebP of every picture and video, so a gallery grid loads about 50 KB a
// tile instead of the whole file (pictures are 1-4 MB, videos far more).
//
//   output/thumbs/<id>.webp     on this machine (the gate serves it at /_orbit/studio/thumb/<id>)
//   gallery/thumbs/<id>.webp    in R2, next to the gallery's files (the site lists and links it)
//
// A picture's thumbnail is the picture at most 480 px on its long side; a video's is one frame from
// about half a second in. Each is made when an item is saved (studio.js keep()), and the ones made
// before thumbnails existed are made in the background when the machine starts (backfill): niced,
// a couple at a time, paused while anything you asked for is being made, and picked up again after
// a restart (what already has a thumbnail is skipped).
//
// Held results never get one here: their thumbnail is kept with them under held/ (held.js).
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const THUMB_SIDE = 480;
/** The folder under the gallery's output/ (and under `gallery/` in R2). */
export const THUMB_DIR = 'thumbs';
const ID = /^[A-Za-z0-9_-]{6,40}$/;
const REMOTE = /^thumbs\/([A-Za-z0-9_-]{6,40})\.webp$/;

/** ffmpeg arguments for one thumbnail (a video's frame from `at` seconds in; none for a picture). */
export function thumbArgs({ input, output, at = null, threads = 0 }) {
  return [
    ...(at ? ['-ss', String(at)] : []),
    '-i',
    input,
    '-frames:v',
    '1',
    '-an',
    // At most 480 px on the long side, never made bigger than it is.
    '-vf',
    `scale='min(${THUMB_SIDE},iw)':'min(${THUMB_SIDE},ih)':force_original_aspect_ratio=decrease`,
    ...(threads ? ['-threads', String(threads)] : []),
    '-c:v',
    'libwebp',
    '-quality',
    '72',
    '-compression_level',
    '4',
    output,
  ];
}

/** Where a video's poster frame is taken: half a second in, or the middle of a shorter one. */
export const posterAt = (seconds) => {
  const s = Number(seconds);
  return Number.isFinite(s) && s > 0 ? Math.min(0.5, Math.round((s / 2) * 100) / 100) : 0.5;
};

/** A WebP file with a picture in it (RIFF....WEBP and more than a header). */
export async function isWebp(file) {
  const h = await fsp.open(file, 'r').catch(() => null);
  if (!h) return false;
  try {
    const buf = Buffer.alloc(16);
    const { bytesRead } = await h.read(buf, 0, 16, 0);
    const st = await h.stat();
    return bytesRead === 16 && st.size > 30 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP';
  } finally {
    await h.close();
  }
}

/**
 * Whether an item may have a public thumbnail: a picture or video, and not one still waiting for its check
 * (about children: only once the check found it fine; a real person's photo: only once the check has looked).
 */
export const wantsThumb = (it) =>
  Boolean(it && ID.test(String(it.id)) && (it.kind === 'image' || it.kind === 'video') && !(it.minorGuard && it.nsfw !== false) && !(it.photoGuard && typeof it.nsfw !== 'boolean'));

/**
 * root: the gallery's output/ folder. ffmpeg: (args, { nice, timeoutMs }) => Promise (movies.js runFfmpeg).
 * mirror: the gallery's R2 mirror (createMirror, prefix gallery/) or null.
 */
export function createThumbs({ root, ffmpeg, mirror = null, log = console, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const dir = path.join(root, THUMB_DIR);
  const local = (id) => path.join(dir, `${id}.webp`);
  /** Ids with a thumbnail on this machine, and ids whose thumbnail is known to be in R2 only. */
  const here = new Set();
  const remote = new Set();
  let scanned = null;
  let seq = 0;

  function scan() {
    scanned ||= fsp
      .readdir(dir)
      .then((names) => {
        for (const n of names) {
          const m = /^([A-Za-z0-9_-]{6,40})\.webp$/.exec(n);
          if (m) here.add(m[1]);
        }
      })
      .catch(() => {});
    return scanned;
  }

  /**
   * Write a thumbnail of `src` (a file path, or a link ffmpeg can read) to `out`. A video whose frame
   * half a second in can't be read (a very short one) gets its first frame. True when it was made.
   */
  async function render(it, src, out, { nice = false } = {}) {
    if (!ffmpeg) return false;
    await fsp.mkdir(path.dirname(out), { recursive: true });
    const tmp = path.join(path.dirname(out), `.${it.id}-${process.pid}-${++seq}.webp`);
    const tries = it.kind === 'video' ? [posterAt(it.seconds), null] : [null];
    try {
      for (const at of tries) {
        try {
          await ffmpeg(thumbArgs({ input: src, output: tmp, at, threads: nice ? 1 : 0 }), { nice, timeoutMs: 90_000 });
          // A seek past the end leaves a few bytes and no picture: only a real WebP counts.
          if (await isWebp(tmp)) {
            await fsp.rename(tmp, out);
            return true;
          }
        } catch (err) {
          if (at == null) throw err;
        }
      }
      return false;
    } catch (err) {
      log.warn?.(`[thumbs] ${it.id}: ${err.message}`);
      return false;
    } finally {
      await fsp.rm(tmp, { force: true }).catch(() => {});
    }
  }

  /** Make an item's thumbnail from `src` and copy it to R2. Returns its path, or null (the grid then uses the file). */
  async function make(it, src, opts = {}) {
    if (!wantsThumb(it)) return null;
    const out = local(it.id);
    if (!(await render(it, src, out, opts))) return null;
    here.add(it.id);
    if (mirror) {
      await mirror.save(out);
      remote.add(it.id);
    }
    return out;
  }

  /** A thumbnail made somewhere else (a held result's: held.js keeps it), never in this folder. Caller removes it. */
  async function makeTemp(it, src) {
    if (!it || !ID.test(String(it.id)) || (it.kind !== 'image' && it.kind !== 'video')) return null;
    const out = path.join(os.tmpdir(), `orbit-thumb-${it.id}-${process.pid}-${++seq}.webp`);
    return (await render(it, src, out)) ? out : null;
  }

  /** The item is gone: its thumbnail goes too, here and in R2. */
  async function drop(id) {
    if (!ID.test(String(id))) return;
    here.delete(id);
    remote.delete(id);
    await fsp.rm(local(id), { force: true }).catch(() => {});
    if (mirror) await mirror.drop(local(id));
  }

  /** The thumbnail's file for sending (brought down from R2 when it was made on another machine), or null. */
  async function file(id) {
    if (!ID.test(String(id))) return null;
    const p = local(id);
    let st = await fsp.stat(p).catch(() => null);
    if (!st && mirror && (await mirror.fetch(p).catch(() => false))) st = await fsp.stat(p).catch(() => null);
    if (!st) {
      here.delete(id);
      remote.delete(id);
      return null;
    }
    here.add(id);
    return { path: p, size: st.size, type: 'image/webp', name: `thumb-${id}.webp` };
  }

  /** Which thumbnails R2 has (one listing): the other machine's count too. */
  async function learnRemote() {
    if (!mirror?.list) return;
    for (const rel of await mirror.list(`${THUMB_DIR}/`)) {
      const m = REMOTE.exec(rel);
      if (m) remote.add(m[1]);
    }
  }

  const failedPath = path.join(dir, '.failed.json');
  const readFailed = () =>
    fsp
      .readFile(failedPath, 'utf8')
      .then((t) => JSON.parse(t) || {})
      .catch(() => ({}));

  let running = null;
  /**
   * Make the missing thumbnails, in the background.
   *   list()      every gallery item (notes)
   *   source(it)  a path or link to its file, or null (gone)
   *   still(id)   whether the item is still there (checked after: a thumbnail of something just deleted is dropped)
   *   busy()      true while anything you asked for is being made: the backfill waits
   * An item that failed twice is left alone (its tile shows the file instead). Returns how many were made.
   */
  function backfill({ list, source, still = async () => true, busy = () => false, batch = 2, pauseMs = 1500, waitMs = 5000 }) {
    if (!ffmpeg) return Promise.resolve(0);
    running ||= (async () => {
      await scan();
      await learnRemote().catch((err) => log.warn?.(`[thumbs] could not list R2: ${err.message}`));
      const failed = await readFailed();
      const todo = (await list()).filter((it) => wantsThumb(it) && !here.has(it.id) && !remote.has(it.id) && (failed[it.id] || 0) < 2);
      if (!todo.length) return 0;
      log.info?.(`[thumbs] making ${todo.length} gallery thumbnails in the background`);
      let made = 0;
      for (let i = 0; i < todo.length; i += batch) {
        while (busy()) await sleep(waitMs);
        await Promise.all(
          todo.slice(i, i + batch).map(async (it) => {
            if (here.has(it.id) || remote.has(it.id)) return;
            const src = await Promise.resolve(source(it)).catch(() => null);
            const out = src ? await make(it, src, { nice: true }) : null;
            if (!out) {
              failed[it.id] = (failed[it.id] || 0) + 1;
              return;
            }
            // Deleted while it was being made: no thumbnail of it may stay behind.
            if (!(await Promise.resolve(still(it.id)).catch(() => true))) await drop(it.id);
            else made++;
          }),
        );
        await fsp.mkdir(dir, { recursive: true }).catch(() => {});
        await fsp.writeFile(failedPath, JSON.stringify(failed)).catch(() => {});
        if (i + batch < todo.length) await sleep(pauseMs);
      }
      log.info?.(`[thumbs] made ${made} gallery thumbnails`);
      return made;
    })()
      .catch((err) => {
        log.warn?.(`[thumbs] backfill stopped: ${err.message}`);
        return 0;
      })
      .finally(() => (running = null));
    return running;
  }

  return {
    dir,
    path: local,
    scan,
    /** A thumbnail is known (here or in R2). Call scan() once first. */
    has: (id) => here.has(id) || remote.has(id),
    /** A thumbnail is on this machine's disk. */
    hasLocal: (id) => here.has(id),
    make,
    makeTemp,
    drop,
    file,
    learnRemote,
    backfill,
    /** The backfill while it runs (null otherwise). */
    backfilling: () => running,
  };
}
