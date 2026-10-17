// soReal: movies made of shots, each continuing from the last frame of the shot before it. The
// movie plan lives on the AI machine (so it keeps going when the phone sleeps and shows on every
// device); shots are ordinary studio jobs; the finished movie is stitched with ffmpeg.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

const newId = () => crypto.randomBytes(9).toString('base64url');
const ID = /^[A-Za-z0-9_-]{6,40}$/;
const err = (message, status) => Object.assign(new Error(message), { status });

/** Run ffmpeg; resolves on exit 0, rejects with the end of its log otherwise. */
export function runFfmpeg(args, { timeoutMs = 10 * 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let log = '';
    p.stderr.on('data', (d) => (log = (log + d).slice(-2000)));
    const t = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.on('error', (e) => {
      clearTimeout(t);
      reject(e.code === 'ENOENT' ? err('ffmpeg is not installed on the AI machine.', 500) : e);
    });
    p.on('close', (code) => {
      clearTimeout(t);
      code === 0 ? resolve() : reject(err(`ffmpeg failed: ${log.trim().split('\n').pop() || code}`, 500));
    });
  });
}

/** The last frame of a video, as a PNG. */
export function lastFrameArgs(input, output) {
  return ['-sseof', '-1', '-i', input, '-update', '1', '-an', output];
}

/**
 * Join clips into one movie. Each clip after the first starts on the previous clip's last frame,
 * so that repeated frame is dropped at every cut.
 */
export function stitchArgs(inputs, output, { audio = true } = {}) {
  const args = [];
  for (const f of inputs) args.push('-i', f);
  const parts = [];
  let chain = '';
  inputs.forEach((_, i) => {
    parts.push(i === 0 ? `[0:v]setpts=PTS-STARTPTS[v0]` : `[${i}:v]trim=start_frame=1,setpts=PTS-STARTPTS[v${i}]`);
    if (audio) parts.push(`[${i}:a]asetpts=PTS-STARTPTS[a${i}]`);
    chain += audio ? `[v${i}][a${i}]` : `[v${i}]`;
  });
  parts.push(`${chain}concat=n=${inputs.length}:v=1:a=${audio ? 1 : 0}${audio ? '[v][a]' : '[v]'}`);
  args.push('-filter_complex', parts.join(';'), '-map', '[v]');
  if (audio) args.push('-map', '[a]', '-c:a', 'aac', '-b:a', '192k');
  // vfr: no padding frames where a clip's sound runs a little past its pictures.
  args.push('-fps_mode', 'vfr', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output);
  return args;
}

/**
 * @param o.dir     studio folder (movies are kept in output/orbit/movies)
 * @param o.studio  the studio (createJob, job, item, cancel, addItem, itemPath)
 */
export function createMovies(o) {
  const { studio } = o;
  const ffmpeg = o.ffmpeg || runFfmpeg;
  const now = o.now || Date.now;
  const pollMs = o.pollMs ?? 3000;
  const log = o.log || console;
  const moviesDir = path.join(o.dir, 'output', 'orbit', 'movies');
  const running = new Map(); // movie id -> { stop: boolean, jobId }

  const file = (id) => path.join(moviesDir, `${id}.json`);
  async function read(id) {
    if (!ID.test(id)) return null;
    try {
      return JSON.parse(await fsp.readFile(file(id), 'utf8'));
    } catch {
      return null;
    }
  }
  async function write(m) {
    m.updatedAt = new Date(now()).toISOString();
    await fsp.mkdir(moviesDir, { recursive: true });
    const tmp = `${file(m.id)}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(m));
    await fsp.rename(tmp, file(m.id));
    return view(m);
  }
  // After a restart nothing is making shots, so a shot left "making" is just waiting.
  const view = (m) => {
    const on = running.has(m.id);
    return { ...m, running: on, shots: on ? m.shots : m.shots.map((s) => (s.status === 'making' ? { ...s, status: 'todo' } : s)) };
  };

  const cleanShot = (s) => ({
    id: ID.test(String(s.id || '')) ? s.id : newId(),
    prompt: String(s.prompt || '').slice(0, 4000),
    itemId: s.itemId && ID.test(String(s.itemId)) ? s.itemId : null,
    status: ['todo', 'making', 'done', 'error'].includes(s.status) ? s.status : 'todo',
    error: s.error ? String(s.error).slice(0, 500) : null,
  });

  async function list() {
    const names = await fsp.readdir(moviesDir).catch(() => []);
    const out = [];
    for (const n of names) if (n.endsWith('.json')) {
      const m = await read(n.slice(0, -5));
      if (m) out.push(view(m));
    }
    return out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  async function create(body = {}) {
    const m = {
      id: newId(),
      title: String(body.title || 'Untitled movie').slice(0, 120),
      look: String(body.look || '').slice(0, 2000),
      maker: body.maker === 'h3-max' ? 'h3-max' : 'ltx',
      size: ['landscape', 'portrait', 'square'].includes(body.size) ? body.size : 'landscape',
      seconds: Math.min(10, Math.max(2, Math.round(Number(body.seconds) || 5))),
      start: body.start && ID.test(String(body.start)) ? String(body.start) : null,
      shots: (Array.isArray(body.shots) ? body.shots : [{}]).slice(0, 60).map(cleanShot),
      render: null,
      createdAt: new Date(now()).toISOString(),
    };
    return write(m);
  }

  async function get(id) {
    const m = await read(id);
    return m ? view(m) : null;
  }

  /** Change the title, look, maker, size, length, start or the shot list (not while it is making shots). */
  async function update(id, body = {}) {
    const m = await read(id);
    if (!m) throw err('No such movie.', 404);
    if (running.has(id)) throw err('Stop the movie first, then change it.', 409);
    if (body.title != null) m.title = String(body.title).slice(0, 120);
    // Anything every shot is made with: changing it remakes the whole movie.
    const before = { look: m.look, maker: m.maker, size: m.size, seconds: m.seconds, start: m.start };
    if (body.look != null) m.look = String(body.look).slice(0, 2000);
    if (body.maker === 'ltx' || body.maker === 'h3-max') m.maker = body.maker;
    if (['landscape', 'portrait', 'square'].includes(body.size)) m.size = body.size;
    if (body.seconds != null) m.seconds = Math.min(10, Math.max(2, Math.round(Number(body.seconds) || 5)));
    if (body.start !== undefined) m.start = body.start && ID.test(String(body.start)) ? String(body.start) : null;
    let changed = Object.keys(before).some((k) => before[k] !== m[k]);
    const shots = Array.isArray(body.shots) ? body.shots.slice(0, 60).map(cleanShot) : m.shots;
    // Keep a shot's result only while it and every shot before it are unchanged, in the same order
    // (each shot starts from the last frame of the one before); from the first change on, remake.
    const old = m.shots;
    m.shots = shots.map((s, i) => {
      const was = old[i];
      if (!changed && was && was.id === s.id && was.prompt === s.prompt) {
        return { ...s, itemId: was.itemId, status: was.status === 'making' ? 'todo' : was.status, error: was.error };
      }
      changed = true;
      return { ...s, itemId: null, status: 'todo', error: null };
    });
    return write(m);
  }

  async function remove(id) {
    const state = running.get(id);
    if (state) {
      state.removed = true;
      await stop(id);
      await state.done;
    }
    await fsp.rm(file(id), { force: true });
    return true;
  }

  const promptFor = (m, shot) => (m.look.trim() ? `${m.look.trim()}\n\n${shot.prompt.trim()}` : shot.prompt.trim());

  /** Make the remaining shots in order, each from the previous shot's last frame. Runs in the background. */
  async function run(id) {
    const m = await read(id);
    if (!m) throw err('No such movie.', 404);
    if (running.has(id)) return view(m);
    if (!m.shots.some((s) => s.status !== 'done' && s.prompt.trim())) throw err('Write what happens in the next shot first.', 400);
    const state = { stop: false, removed: false, jobId: null, done: null };
    running.set(id, state);
    state.done = loop(id, state).catch((e) => log.warn?.(`[movies] ${e.message}`));
    return view(m);
  }

  async function loop(id, state) {
    try {
      for (;;) {
        const m = await read(id);
        if (!m || state.stop) return;
        const idx = m.shots.findIndex((s) => s.status !== 'done');
        if (idx < 0) return;
        const shot = m.shots[idx];
        if (!shot.prompt.trim()) return;
        const prev = idx > 0 ? m.shots[idx - 1].itemId : m.start;
        const prevItem = prev ? await studio.item(prev) : null;
        if (prev && !prevItem) {
          // Never quietly start over from words: the shot must continue the one before.
          Object.assign(shot, { status: 'error', error: idx > 0 ? 'The shot before this one is no longer in your gallery. Remake it first.' : 'The picture or video to start from is no longer in your gallery. Pick another one.' });
          await write(m);
          return;
        }
        const req = { kind: 'video', maker: m.maker, prompt: promptFor(m, shot), size: m.size, seconds: m.seconds };
        if (prevItem?.kind === 'video') req.fromLastFrameOf = prevItem.id;
        else if (prevItem?.kind === 'image') req.fromItem = prevItem.id;
        shot.status = 'making';
        shot.error = null;
        await write(m);
        let job;
        try {
          job = await studio.createJob(req);
        } catch (e) {
          job = { status: 'error', error: e.message };
        }
        state.jobId = job.id || null;
        while (job.status === 'queued' || job.status === 'running') {
          await new Promise((r) => setTimeout(r, pollMs));
          job = studio.job(job.id) || { status: 'error', error: 'The shot went missing.' };
        }
        if (state.removed) return;
        const latest = await read(id);
        if (!latest) return;
        const s = latest.shots.find((x) => x.id === shot.id);
        if (s) {
          if (job.status === 'done' && job.item) Object.assign(s, { status: 'done', itemId: job.item.id, error: null });
          else Object.assign(s, { status: job.status === 'stopped' ? 'todo' : 'error', error: job.status === 'stopped' ? null : job.error || 'The shot failed.' });
        }
        await write(latest);
        if (job.status !== 'done') return;
      }
    } finally {
      running.delete(id);
    }
  }

  async function stop(id) {
    const state = running.get(id);
    if (state) {
      state.stop = true;
      if (state.jobId) await studio.cancel(state.jobId).catch(() => {});
    }
    const m = await read(id);
    return m ? view(m) : null;
  }

  /** Join the finished shots into one movie in the gallery. */
  async function render(id) {
    const m = await read(id);
    if (!m) throw err('No such movie.', 404);
    const shots = m.shots.filter((s) => s.status === 'done' && s.itemId);
    if (!shots.length) throw err('Make at least one shot first.', 400);
    const inputs = [];
    let seconds = 0;
    let width;
    let height;
    let photo = false;
    for (const s of shots) {
      const it = await studio.item(s.itemId);
      const p = it && (await studio.itemPath(s.itemId));
      if (!p) throw err('A shot is no longer in your gallery. Remake it, then try again.', 409);
      inputs.push(p);
      seconds += it.seconds || 0;
      photo ||= Boolean(it.photo);
      width ??= it.width;
      height ??= it.height;
    }
    const rel = `orbit/movie-${m.id}-${now()}.mp4`;
    const out = path.join(o.dir, 'output', rel);
    try {
      await ffmpeg(stitchArgs(inputs, out));
    } catch {
      // A clip without sound: join the pictures only.
      await ffmpeg(stitchArgs(inputs, out, { audio: false }));
    }
    const item = await studio.addItem({ kind: 'video', prompt: m.title, file: rel, seconds, width, height, movie: m.id, photo });
    m.render = { itemId: item.id, at: new Date(now()).toISOString() };
    await write(m);
    return { movie: view(m), item };
  }

  /** True while a movie is making shots (keeps the machine from turning off between shots). */
  const busy = () => running.size > 0;

  return { list, create, get, update, remove, run, stop, render, busy };
}
