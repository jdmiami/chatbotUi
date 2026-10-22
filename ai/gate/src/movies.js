// soReal: movies made of shots. The movie plan lives on the AI machine (so it keeps going when the
// phone sleeps and shows on every device); every step is an ordinary studio job; the finished movie
// is stitched with ffmpeg.
//
// Two kinds of movie:
// - "auto" (soReal today): one idea in, a whole movie out. A chat model writes the story, the lead
//   gets a reference picture (designed by the AI, or from an uploaded photo), a storyboard picture
//   is made for every cut, and each shot is made BETWEEN two storyboard pictures (first and last
//   frame), so cuts land on planned frames and the movie doesn't drift. Then it is stitched.
//   With `continuity: 'chain'` (the Lab's movies) only the first storyboard picture is made and
//   each shot starts from the LAST FRAME of the shot before instead.
// - the original kind (no `flow`): shots written by hand, each continuing from the LAST FRAME of
//   the shot before. Kept as it was, so older movies still open and make the same way.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { SOUNDS, TEMPLATES, checkMovieText, createWriter } from './story.js';
import { shotPromptFor } from './prompting.js';

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
 * so that repeated frame is dropped at every cut. `trims[i]` ({ start, end } in seconds, `end`
 * being where the clip stops) cuts a clip shorter.
 */
export function stitchArgs(inputs, output, { audio = true, trims = [] } = {}) {
  const args = [];
  for (const f of inputs) args.push('-i', f);
  const parts = [];
  let chain = '';
  const cut = (t, sound) => {
    if (!t || !(t.start > 0 || t.end > 0)) return '';
    const range = [t.start > 0 ? `start=${t.start}` : '', t.end > 0 ? `end=${t.end}` : ''].filter(Boolean).join(':');
    return sound ? `,atrim=${range},asetpts=PTS-STARTPTS` : `,trim=${range},setpts=PTS-STARTPTS`;
  };
  inputs.forEach((_, i) => {
    parts.push(`${i === 0 ? '[0:v]setpts=PTS-STARTPTS' : `[${i}:v]trim=start_frame=1,setpts=PTS-STARTPTS`}${cut(trims[i], false)}[v${i}]`);
    if (audio) parts.push(`[${i}:a]asetpts=PTS-STARTPTS${cut(trims[i], true)}[a${i}]`);
    chain += audio ? `[v${i}][a${i}]` : `[v${i}]`;
  });
  parts.push(`${chain}concat=n=${inputs.length}:v=1:a=${audio ? 1 : 0}${audio ? '[v][a]' : '[v]'}`);
  args.push('-filter_complex', parts.join(';'), '-map', '[v]');
  if (audio) args.push('-map', '[a]', '-c:a', 'aac', '-b:a', '192k');
  // vfr: no padding frames where a clip's sound runs a little past its pictures.
  args.push('-fps_mode', 'vfr', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output);
  return args;
}

// ---------------------------------------------------------------- the auto movie's settings

/** Each shot is about this long; the movie's length decides how many shots it has. */
export const SHOT_SECONDS = 5;
/** 30 seconds is the longest movie. */
export const MAX_LENGTH = 30;
export const shotCount = (length, seconds = SHOT_SECONDS) => Math.max(1, Math.round(length / seconds));
const clampLength = (v) => Math.min(MAX_LENGTH, Math.max(5, Math.round((Number(v) || 20) / 5) * 5));
const LEAD_MODES = ['auto', 'ai', 'photo', 'none'];
/** Makers that can take a first AND a last frame (LTX via LTXVAddGuide, H3 via its last_frame input). */
const KEYFRAME_MAKERS = ['ltx', 'h3-max'];
/** Picture sizes that match the movie's shape. */
const PICTURE = { portrait: 'tall', landscape: 'wide' };
/** Seconds for the parts no studio job measures. */
const STORY_SECONDS = 45;
const FINAL_SECONDS = 20;

const LEAD_FROM_PHOTO =
  'Keep this exact person: the same face, hair, skin and build, wearing the same clothes. Show them from the knees up, facing the camera, standing against a plain light grey background, soft even light.';

const text = (v, max) => String(v ?? '').slice(0, max);
/** A first name for a movie, from its idea (the story's writer usually names it better). */
export function ideaTitle(idea) {
  const t = String(idea || '').trim().replace(/\s+/g, ' ');
  if (!t) return 'Untitled movie';
  return t.length > 48 ? `${t.slice(0, 47).replace(/\s+\S*$/, '')}…` : t;
}
const trimSeconds = (v) => Math.min(3, Math.max(0, Math.round((Number(v) || 0) * 2) / 2));

/**
 * @param o.dir     studio folder (movies are kept in output/orbit/movies)
 * @param o.studio  the studio (createJob, job, item, cancel, addItem, itemPath, estimate?)
 * @param o.chat    async ({ system, user }) => reply, a chat model on this machine (writes stories)
 */
export function createMovies(o) {
  const { studio } = o;
  const ffmpeg = o.ffmpeg || runFfmpeg;
  const now = o.now || Date.now;
  const pollMs = o.pollMs ?? 3000;
  const log = o.log || console;
  const writeStory = o.writer || createWriter({ chat: o.chat, log });
  // With R2 (no network volume), movies are kept there too: see studio.js.
  const mirror = o.mirror || null;
  let pulledAt = 0;
  const saves = new Map(); // movie id -> its latest upload
  const moviesDir = path.join(o.dir, 'output', 'orbit', 'movies');
  const running = new Map(); // movie id -> { stop: boolean, jobId, step }
  // Two AI machines (main and helper) share the movies folder. The one making a movie marks it
  // with its name and a recent time, so the other leaves it alone and shows it as being made.
  const machine = o.machine || 'main';
  const BEAT_MS = 10_000;
  const elsewhere = (m) => Boolean(m.runningOn && m.runningOn.machine !== machine && now() - Date.parse(m.runningOn.at) < 4 * BEAT_MS);
  const busyElsewhere = (m) => err(`This movie is being made on your ${m.runningOn.machine === 'helper' ? 'helper' : 'main'} AI machine. Stop it there first.`, 409);

  const file = (id) => path.join(moviesDir, `${id}.json`);
  async function read(id) {
    if (!ID.test(id)) return null;
    try {
      return JSON.parse(await fsp.readFile(file(id), 'utf8'));
    } catch {
      if (mirror && (await mirror.fetch(file(id)).catch(() => false))) return JSON.parse(await fsp.readFile(file(id), 'utf8'));
      return null;
    }
  }
  async function write(m) {
    m.updatedAt = new Date(now()).toISOString();
    if (running.has(m.id) && !running.get(m.id).finished) m.runningOn = { machine, at: m.updatedAt };
    else if (m.runningOn?.machine === machine) delete m.runningOn;
    await fsp.mkdir(moviesDir, { recursive: true });
    const tmp = `${file(m.id)}.${newId()}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(m));
    await fsp.rename(tmp, file(m.id));
    // One upload at a time per movie, each reading the file as it is then: the last word always wins.
    if (mirror) saves.set(m.id, (saves.get(m.id) || Promise.resolve()).then(() => mirror.save(file(m.id))));
    return view(m);
  }
  // After a restart nothing is making shots, so a shot left "making" is just waiting.
  const view = (m) => {
    const on = running.has(m.id) || elsewhere(m);
    const { runningOn, ...rest } = m;
    const idle = (s) => (s.status === 'making' ? { ...s, status: 'todo' } : s);
    const out = { ...rest, running: on, runningOn: on ? (running.has(m.id) ? machine : runningOn.machine) : null, shots: on ? m.shots : m.shots.map(idle) };
    if (m.flow === 'auto') {
      if (!on) {
        out.frames = m.frames.map(idle);
        if (m.lead.status === 'making' && !m.lead.jobId) out.lead = { ...m.lead, status: 'todo' };
        if (['story', 'lead', 'storyboard', 'shots', 'final'].includes(m.phase)) out.phase = 'stopped';
      }
      out.etaSeconds = remainingSeconds(m, on ? running.get(m.id) : null);
      out.shotSeconds = m.seconds;
      // A Lab movie waiting for your job to finish (it made way for it, and carries on after).
      out.paused = Boolean(on && running.get(m.id)?.paused);
    }
    return out;
  };

  const cleanShot = (s) => ({
    id: ID.test(String(s.id || '')) ? s.id : newId(),
    prompt: String(s.prompt || '').slice(0, 4000),
    itemId: s.itemId && ID.test(String(s.itemId)) ? s.itemId : null,
    status: ['todo', 'making', 'done', 'error'].includes(s.status) ? s.status : 'todo',
    error: s.error ? String(s.error).slice(0, 500) : null,
  });

  async function list() {
    if (mirror && now() - pulledAt > 10_000) {
      pulledAt = now();
      await mirror.pull('orbit/movies/', (rel) => rel.endsWith('.json')).catch((err) => log.warn?.(`[movies] could not read movies from R2: ${err.message}`));
    }
    const names = await fsp.readdir(moviesDir).catch(() => []);
    const out = [];
    for (const n of names) if (n.endsWith('.json')) {
      const m = await read(n.slice(0, -5));
      // The Lab's movies stay in the Lab until you keep one.
      if (m && !m.lab) out.push(view(m));
    }
    return out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  async function create(body = {}) {
    if (body.flow === 'auto' || body.idea != null) return createAuto(body);
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
    if (!m) return null;
    if (m.flow === 'auto' && !running.has(id) && (await settleLeadPhoto(m))) return write(m);
    return view(m);
  }

  /** Change the title, look, maker, size, length, start or the shot list (not while it is making shots). */
  async function update(id, body = {}) {
    const m = await read(id);
    if (!m) throw err('No such movie.', 404);
    if (running.has(id)) throw err('Stop the movie first, then change it.', 409);
    if (elsewhere(m)) throw busyElsewhere(m);
    if (m.flow === 'auto') return updateAuto(m, body);
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
    const m = await read(id);
    if (m && elsewhere(m)) throw busyElsewhere(m);
    const state = running.get(id);
    if (state) {
      state.removed = true;
      await stop(id);
      await state.done;
    }
    // A Lab movie's pictures and shots were only ever in the Lab: they go with it.
    if (m?.lab) for (const itemId of itemsOf((await read(id)) || m)) await studio.remove?.(itemId).catch(() => {});
    await fsp.rm(file(id), { force: true });
    if (mirror) await mirror.drop(file(id));
    return true;
  }

  const promptFor = (m, shot) => (m.look.trim() ? `${m.look.trim()}\n\n${shot.prompt.trim()}` : shot.prompt.trim());

  /**
   * Make what is left, in the background. Original movies: the remaining shots in order, each from
   * the previous shot's last frame. Auto movies: story, lead, storyboard, shots, final cut.
   * `opts.approve` says the storyboard looks right (when it was set to be checked first).
   */
  async function run(id, opts = {}) {
    // Stopping at the storyboard check: let that run end, then go on.
    if (running.get(id)?.waiting) await running.get(id).done;
    const m = await read(id);
    if (!m) throw err('No such movie.', 404);
    if (running.has(id)) return view(m);
    if (elsewhere(m)) throw busyElsewhere(m);
    if (m.flow === 'auto') {
      if (!m.idea.trim() && !m.shots.some((s) => s.prompt.trim())) throw err("Say what your movie is about first.", 400);
      checkMovie(m);
      if (opts.approve) m.approved = true;
      m.error = null;
      if (m.phase === 'error' || m.phase === 'stopped' || m.phase === 'draft' || m.phase === 'review' || m.phase === 'done') m.phase = 'story';
      await write(m);
    } else if (!m.shots.some((s) => s.status !== 'done' && s.prompt.trim())) throw err('Write what happens in the next shot first.', 400);
    const state = { stop: false, removed: false, jobId: null, step: null, done: null, background: Boolean(m.background), paused: false };
    running.set(id, state);
    state.done = (m.flow === 'auto' ? autoLoop(id, state) : loop(id, state)).catch((e) => log.warn?.(`[movies] ${e.message}`));
    return view(await read(id));
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** You are making something: a job of yours, or one of your own movies between its shots. */
  const ownerBusy = () => Boolean(studio.hasUserWork?.()) || [...running.values()].some((s) => !s.background && !s.finished && !s.waiting);

  /** A Lab movie (background): while you have a job, it waits, then carries on where it was. */
  async function yieldToOwner(id, state) {
    if (!state.background || !ownerBusy()) return;
    state.paused = true;
    let beat = now();
    while (ownerBusy() && !state.stop && !state.removed) {
      await sleep(pollMs);
      if (now() - beat >= BEAT_MS) {
        beat = now();
        const cur = await read(id);
        if (cur) await write(cur);
      }
    }
    state.paused = false;
  }

  /** Start a studio job and wait for it, keeping the "being made here" mark fresh. */
  async function waitJob(id, state, req, step) {
    for (;;) {
      await yieldToOwner(id, state);
      if (state.stop || state.removed) return { status: 'stopped', error: 'Stopped.' };
      let job;
      try {
        job = await studio.createJob(state.background ? { ...req, background: true } : req);
      } catch (e) {
        job = { status: 'error', error: e.message };
      }
      state.jobId = job.id || null;
      state.step = step;
      let beat = now();
      while (job.status === 'queued' || job.status === 'running') {
        await sleep(pollMs);
        job = studio.job(job.id) || { status: 'error', error: 'The job went missing.' };
        if (now() - beat >= BEAT_MS && !state.removed) {
          // Still making it: tell the other machine (write() stamps the time).
          beat = now();
          const cur = await read(id);
          if (cur) await write(cur);
        }
      }
      state.jobId = null;
      state.step = null;
      // A Lab movie's step that made way for your job: made again once yours is done.
      if (state.background && job.status === 'stopped' && !state.stop && !state.removed && (state.yielded || 0) < 100) {
        state.yielded = (state.yielded || 0) + 1;
        continue;
      }
      return job;
    }
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
        const job = await waitJob(id, state, req, { kind: 'shot', id: shot.id });
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
      await finishRun(id, state);
    }
  }

  async function finishRun(id, state) {
    // Done here: clear this machine's mark so the movie can be changed or made elsewhere.
    state.finished = true;
    const last = state.removed ? null : await read(id).catch(() => null);
    if (last?.runningOn?.machine === machine) await write(last).catch(() => {});
    running.delete(id);
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
    const trims = [];
    let seconds = 0;
    let width;
    let height;
    let photo = false;
    for (const s of shots) {
      const it = await studio.item(s.itemId);
      const p = it && (await studio.itemPath(s.itemId));
      if (!p) throw err('A shot is no longer in your gallery. Remake it, then try again.', 409);
      inputs.push(p);
      const length = it.seconds || 0;
      const start = s.trimStart || 0;
      const end = s.trimEnd && length ? Math.max(start + 0.5, length - s.trimEnd) : 0;
      trims.push({ start, end });
      seconds += Math.max(0, (end || length) - start);
      photo ||= Boolean(it.photo);
      width ??= it.width;
      height ??= it.height;
    }
    const rel = `orbit/movie-${m.id}-${now()}.mp4`;
    const out = path.join(o.dir, 'output', rel);
    const quiet = m.flow === 'auto' && soundOf(m) === 'quiet';
    const cuts = trims.some((t) => t.start || t.end) ? { trims } : {};
    try {
      await ffmpeg(stitchArgs(inputs, out, { audio: !quiet, ...cuts }));
    } catch (e) {
      if (quiet) throw e;
      // A clip without sound: join the pictures only.
      await ffmpeg(stitchArgs(inputs, out, { audio: false, ...cuts }));
    }
    const item = await studio.addItem({ kind: 'video', prompt: m.title, file: rel, seconds: Math.round(seconds * 10) / 10, width, height, movie: m.id, photo, ...(m.lab ? { lab: true } : {}), ...(m.nsfw ? { nsfw: true } : {}), ...(m.owner ? { owner: m.owner } : {}) });
    // Shots may have changed while it was being joined: read it again before saying it is current.
    const latest = (await read(id)) || m;
    latest.render = { itemId: item.id, at: new Date(now()).toISOString() };
    await write(latest);
    return { movie: view(latest), item };
  }

  // ---------------------------------------------------------------- auto movies

  const soundOf = (m) => (m.sound === 'auto' ? m.soundPicked || TEMPLATES[m.template]?.sound || 'shots' : m.sound);

  function cleanLead(l = {}, was = {}) {
    const mode = LEAD_MODES.includes(l.mode) ? l.mode : was.mode || 'auto';
    return {
      mode,
      description: text(l.description ?? was.description ?? '', 600),
      itemId: was.itemId ?? null,
      jobId: was.jobId ?? null,
      status: was.status || 'todo',
      error: was.error ?? null,
    };
  }

  const cleanFrame = (f = {}) => ({
    id: ID.test(String(f.id || '')) ? f.id : newId(),
    prompt: text(f.prompt, 1000),
    itemId: f.itemId && ID.test(String(f.itemId)) ? f.itemId : null,
    status: ['todo', 'making', 'done', 'error'].includes(f.status) ? f.status : 'todo',
    error: f.error ? String(f.error).slice(0, 500) : null,
  });

  const cleanAutoShot = (s = {}) => ({
    ...cleanShot(s),
    end: text(s.end, 1000),
    // What is said or sung in the shot (one line each). Not sent when you only edit other things.
    says: s.says === undefined ? undefined : String(s.says ?? '').slice(0, 900),
    trimStart: trimSeconds(s.trimStart),
    trimEnd: trimSeconds(s.trimEnd),
    frames: Array.isArray(s.frames) && s.frames.length === 2 && s.frames.every((f) => ID.test(String(f))) ? s.frames.map(String) : null,
  });

  async function createAuto(body) {
    const maker = body.maker === 'h3-max' ? 'h3-max' : 'ltx';
    const m = {
      id: newId(),
      flow: 'auto',
      // A studio member's film (gate.js sets it from their key, never from the request body).
      owner: typeof body.owner === 'string' && body.owner ? body.owner.slice(0, 120) : undefined,
      title: text(body.title, 120).trim() || ideaTitle(body.idea),
      // Named for you until you name it.
      autoTitle: !text(body.title, 120).trim(),
      idea: text(body.idea, 2000),
      template: TEMPLATES[body.template] ? body.template : null,
      length: clampLength(body.length),
      size: body.size === 'landscape' ? 'landscape' : 'portrait',
      maker,
      seconds: SHOT_SECONDS,
      look: text(body.look, 2000),
      start: null,
      opening: text(body.opening, 1000),
      lead: cleanLead(body.lead),
      sound: SOUNDS.includes(body.sound) ? body.sound : 'auto',
      soundPicked: null,
      reviewStoryboard: Boolean(body.reviewStoryboard),
      approved: false,
      // chain: each shot starts from the last frame of the shot before (only the first picture is
      // made). The Lab asks for it; otherwise a maker that takes two frames goes between keyframes.
      continuity: body.continuity === 'chain' || !KEYFRAME_MAKERS.includes(maker) ? 'chain' : 'keyframes',
      story: null,
      frames: [],
      shots: (Array.isArray(body.shots) ? body.shots : []).slice(0, 12).map(cleanAutoShot).filter((s) => s.prompt.trim()),
      phase: 'draft',
      error: null,
      render: null,
      createdAt: new Date(now()).toISOString(),
    };
    // Made by the Lab (memes.js, never from a request): kept out of soReal until you keep it, its
    // studio jobs wait behind yours and make way for them, and its cut may be blurred as NSFW.
    if (body.lab) Object.assign(m, { lab: true, background: true, nsfw: Boolean(body.nsfw) || undefined });
    if (m.shots.length) {
      m.story = 'you';
      syncFrames(m);
    }
    checkMovie(m);
    return write(m);
  }

  /** Everything the movie is made from, through the content rules (stricter with a photo lead). */
  function checkMovie(m) {
    checkMovieText([m.idea, m.title, m.look, m.opening, m.lead.description, ...m.shots.flatMap((s) => [s.prompt, s.end, s.says]), ...(m.frames || []).map((f) => f.prompt)], {
      photo: m.lead.mode === 'photo',
    });
  }

  const shotsMade = (m) => m.shots.some((s) => s.itemId || s.status === 'done');

  /**
   * Storyboard pictures for the shots: one at the start, then one where each shot ends (the next
   * one starts there). Pictures already made for the same words are kept.
   */
  function syncFrames(m) {
    const wanted = [m.opening || m.shots[0]?.prompt || m.idea, ...m.shots.map((s) => s.end || `${s.prompt.replace(/[.\s]+$/, '')}. The last moment of this shot.`)];
    const old = m.frames || [];
    m.frames = wanted.map((prompt, k) => {
      const was = old[k];
      return was && was.prompt === prompt ? was : cleanFrame({ prompt });
    });
    m.shots.forEach((s, i) => (s.frames = [m.frames[i].id, m.frames[i + 1].id]));
  }

  /** The look, the lead or the shape changed: every picture and shot is made again. */
  function resetPictures(m, { lead = true } = {}) {
    if (lead && m.lead.mode !== 'photo') Object.assign(m.lead, { itemId: null, jobId: null, status: 'todo', error: null });
    m.frames = m.frames.map((f) => ({ ...f, itemId: null, status: 'todo', error: null }));
    resetShots(m);
    m.approved = false;
  }
  function resetShots(m, which = () => true) {
    m.shots = m.shots.map((s) => (which(s) ? { ...s, itemId: null, status: 'todo', error: null } : s));
    staleCut(m);
  }
  const staleCut = (m) => {
    if (m.render) m.render = { ...m.render, stale: true };
  };

  async function updateAuto(m, body) {
    if (body.title != null && text(body.title, 120).trim()) {
      m.title = text(body.title, 120).trim();
      m.autoTitle = false;
    }
    if (body.idea != null && text(body.idea, 2000) !== m.idea) {
      m.idea = text(body.idea, 2000);
      if (m.autoTitle) m.title = ideaTitle(m.idea);
    }
    if (body.template !== undefined) m.template = TEMPLATES[body.template] ? body.template : null;
    if (body.length != null) m.length = clampLength(body.length);
    if (body.reviewStoryboard != null) m.reviewStoryboard = Boolean(body.reviewStoryboard);
    if (body.opening != null && body.opening !== m.opening) {
      m.opening = text(body.opening, 1000);
      if (!shotsMade(m) && m.shots.length) syncFrames(m);
    }
    // The shape, the look and the lead are in every picture.
    const size = body.size === 'landscape' || body.size === 'portrait' ? body.size : m.size;
    const look = body.look != null ? text(body.look, 2000) : m.look;
    const lead = body.lead ? cleanLead(body.lead, m.lead) : m.lead;
    const leadChanged = lead.mode !== m.lead.mode || lead.description !== m.lead.description;
    if (size !== m.size || look !== m.look || leadChanged) {
      const photoKept = lead.mode === 'photo' && m.lead.mode === 'photo';
      m.size = size;
      m.look = look;
      m.lead = lead;
      if (!photoKept && lead.mode === 'photo') Object.assign(m.lead, { itemId: null, jobId: null, status: 'todo' });
      resetPictures(m, { lead: !photoKept });
    }
    if ((body.maker === 'ltx' || body.maker === 'h3-max') && body.maker !== m.maker) {
      m.maker = body.maker;
      // A chained movie (the Lab's) stays chained: its storyboard has only the first picture.
      if (m.continuity !== 'chain') m.continuity = KEYFRAME_MAKERS.includes(m.maker) ? 'keyframes' : 'chain';
      resetShots(m);
    }
    if (body.sound != null && (body.sound === 'auto' || SOUNDS.includes(body.sound)) && body.sound !== m.sound) {
      const before = soundOf(m);
      m.sound = body.sound;
      const after = soundOf(m);
      // Going quiet only drops the sound when joining. Music or natural sound is made with each shot,
      // and so are the spoken or sung lines, so shots made quiet have to be made again to speak.
      if (before !== after && ((before !== 'quiet' && after !== 'quiet') || (before === 'quiet' && m.shots.some((x) => x.says)))) resetShots(m);
      else staleCut(m);
    }
    if (Array.isArray(body.shots)) applyShots(m, body.shots.slice(0, 12).map((s) => ({ ...cleanAutoShot(s), redo: Boolean(s.redo) })));
    if (Array.isArray(body.frames)) applyFrames(m, body.frames);
    checkMovie(m);
    if (m.phase === 'done' && (m.render?.stale || m.shots.some((s) => s.status !== 'done'))) m.phase = 'draft';
    return write(m);
  }

  // What is said or sung stays as it was when an edit doesn't send it.
  const saysOf = (s, was) => (s.says === undefined ? was?.says || '' : s.says);
  const sameWords = (was, s) => was.prompt === s.prompt && (was.says || '') === saysOf(s, was);

  function applyShots(m, next) {
    const old = new Map(m.shots.map((s) => [s.id, s]));
    if (!shotsMade(m) || m.continuity === 'chain') {
      if (m.continuity === 'chain' && shotsMade(m)) {
        // Chained shots each start from the one before: from the first change on, remake.
        let changed = false;
        m.shots = next.map(({ redo, ...s }, i) => {
          const was = m.shots[i];
          if (!changed && was && was.id === s.id && sameWords(was, s) && !redo) return { ...was, trimStart: s.trimStart, trimEnd: s.trimEnd };
          changed = true;
          return { ...s, says: saysOf(s, was), frames: was?.frames ?? s.frames, itemId: null, status: 'todo', error: null };
        });
        staleCut(m);
        return;
      }
      // Still the plan: the storyboard follows the words.
      m.shots = next.map(({ redo, ...s }) => ({ ...s, says: saysOf(s, old.get(s.id)), itemId: null, status: 'todo', error: null }));
      if (m.story !== 'you' && next.some((s) => !old.get(s.id) || !sameWords(old.get(s.id), s))) m.story = 'you';
      if (m.shots.length) syncFrames(m);
      else m.frames = [];
      return;
    }
    // Shots between storyboard pictures stand on their own: reorder, trim or cut any of them, and
    // only a shot whose words changed (or that you asked to redo) is made again.
    const before = m.shots.map((s) => `${s.id}:${s.trimStart}:${s.trimEnd}`).join();
    m.shots = next
      .filter((s) => old.has(s.id) || s.prompt.trim())
      .map(({ redo, ...s }) => {
        const was = old.get(s.id);
        if (!was) return { ...s, says: saysOf(s, null), itemId: null, status: 'todo', error: null };
        const keep = !redo && sameWords(was, s);
        return { ...was, prompt: s.prompt, says: saysOf(s, was), end: s.end || was.end, trimStart: s.trimStart, trimEnd: s.trimEnd, ...(keep ? {} : { itemId: null, status: 'todo', error: null }) };
      });
    if (m.shots.map((s) => `${s.id}:${s.trimStart}:${s.trimEnd}`).join() !== before || m.shots.some((s) => s.status !== 'done')) staleCut(m);
  }

  function applyFrames(m, next) {
    for (const f of next) {
      const frame = m.frames.find((x) => x.id === f?.id);
      if (!frame) continue;
      const prompt = f.prompt != null ? text(f.prompt, 1000) : frame.prompt;
      if (prompt === frame.prompt && !f.redo) continue;
      Object.assign(frame, { prompt, itemId: null, status: 'todo', error: null });
      // Shots made from this picture are made again.
      resetShots(m, (s) => Boolean(s.frames?.includes(frame.id)) || (m.continuity === 'chain' && frame === m.frames[0]));
    }
  }

  /** Write (or rewrite) the story: the shots, the storyboard words, the lead, look and sound. */
  async function plan(id) {
    const m = await read(id);
    if (!m) throw err('No such movie.', 404);
    if (m.flow !== 'auto') throw err('Only new movies are written for you.', 400);
    if (running.has(id)) throw err('Stop the movie first, then change it.', 409);
    if (elsewhere(m)) throw busyElsewhere(m);
    if (!m.idea.trim()) throw err("Say what your movie is about first.", 400);
    checkMovie(m);
    await story(m);
    return write(m);
  }

  async function story(m) {
    const count = shotCount(m.length, m.seconds);
    const s = await writeStory({
      idea: m.idea,
      template: m.template,
      count,
      seconds: m.seconds,
      lead: m.lead.mode === 'none' ? '' : m.lead.mode === 'photo' ? 'the person in the photo you were given (call them "the lead")' : m.lead.description,
      look: m.look,
      shape: m.size,
      sound: m.sound === 'auto' ? null : m.sound,
    });
    const leadText = m.lead.mode === 'photo' ? '' : m.lead.description || s.lead;
    // What the writer wrote is checked too, before any of it is made.
    checkMovieText([s.title, s.lead, s.look, s.opening, ...s.shots.flatMap((x) => [x.action, x.end, x.says])], { photo: m.lead.mode === 'photo' });
    if ((m.autoTitle || !m.title || m.title === 'Untitled movie') && s.title) m.title = s.title;
    if (!m.look.trim()) m.look = s.look || TEMPLATES[m.template]?.look || '';
    if (m.lead.mode === 'auto') m.lead.mode = leadText ? 'ai' : 'none';
    if (m.lead.mode === 'ai' && !m.lead.description) m.lead.description = leadText;
    if (m.sound === 'auto') m.soundPicked = TEMPLATES[m.template]?.sound || s.sound || 'shots';
    m.opening = s.opening || '';
    m.shots = s.shots.map((x) => cleanAutoShot({ prompt: x.action, end: x.end, says: x.says || '' }));
    m.story = s.by;
    m.frames = [];
    syncFrames(m);
    m.approved = false;
    m.render = null;
  }

  /** A lead photo being cleaned up into a reference picture: note its result when it is ready. */
  async function settleLeadPhoto(m) {
    if (m.lead.mode !== 'photo' || m.lead.itemId || !m.lead.jobId || m.lead.status !== 'making') return false;
    const job = studio.job(m.lead.jobId);
    if (!job) Object.assign(m.lead, { status: 'error', jobId: null, error: 'The photo of your lead was lost (the AI machine restarted). Add it again.' });
    else if (job.status === 'done' && job.item) Object.assign(m.lead, { status: 'done', itemId: job.item.id, error: null });
    else if (job.status === 'error' || job.status === 'stopped') Object.assign(m.lead, { status: 'error', jobId: null, error: job.error || 'The photo could not be used.' });
    else return false;
    return true;
  }

  /** The lead from a photo: it is cleaned up into a reference picture straight away. */
  async function leadPhoto(id, photo) {
    const m = await read(id);
    if (!m) throw err('No such movie.', 404);
    if (m.flow !== 'auto') throw err('Only new movies have a lead.', 400);
    if (running.has(id)) throw err('Stop the movie first, then change it.', 409);
    if (elsewhere(m)) throw busyElsewhere(m);
    // A photo may show a real person: the whole movie keeps the photo rule.
    checkMovieText([m.idea, m.title, m.look, m.opening, m.lead.description, ...m.shots.flatMap((s) => [s.prompt, s.end, s.says]), ...m.frames.map((f) => f.prompt)], { photo: true });
    const job = await studio.createJob({ kind: 'image', maker: 'edit', image: photo, prompt: LEAD_FROM_PHOTO });
    m.lead = { ...m.lead, mode: 'photo', jobId: job.id, itemId: null, status: 'making', error: null };
    resetPictures(m, { lead: false });
    return write(m);
  }

  /** How long what is left takes, from the studio's learned timings (seconds). */
  function remainingSeconds(m, state = null) {
    const est = (req) => {
      const s = studio.estimate?.(req);
      if (Number.isFinite(s) && s > 0) return s;
      return req.kind === 'video' ? 60 * (req.seconds || 5) : req.maker === 'edit' ? 60 : 40;
    };
    const n = m.shots.length || shotCount(m.length, m.seconds);
    let total = 0;
    const current = state?.jobId ? studio.job(state.jobId) : null;
    const at = (step, full) => (current && state.step?.kind === step.kind && state.step?.id === step.id && current.etaSeconds != null ? current.etaSeconds : full);
    if (!m.shots.some((s) => s.prompt.trim())) total += STORY_SECONDS;
    const leadMode = m.lead.mode === 'auto' ? 'ai' : m.lead.mode;
    const withLead = leadMode === 'ai' || leadMode === 'photo';
    let firstPicture = true;
    if (leadMode === 'ai' && !m.lead.itemId) {
      total += at({ kind: 'lead', id: 'lead' }, est({ kind: 'image', maker: 'qwen', size: PICTURE[m.size], cold: true }));
      firstPicture = false;
    }
    const frames = m.frames.length ? m.frames : Array.from({ length: n + 1 }, () => ({ itemId: null }));
    const needed = m.continuity === 'keyframes' ? frames : frames.slice(0, 1);
    needed.forEach((f, k) => {
      if (f.itemId) return;
      const maker = withLead || k > 0 ? 'edit' : 'qwen';
      total += at({ kind: 'frame', id: f.id }, est({ kind: 'image', maker, size: PICTURE[m.size], cold: firstPicture }));
      firstPicture = false;
    });
    let firstShot = true;
    const shots = m.shots.length ? m.shots : Array.from({ length: n }, () => ({ status: 'todo' }));
    for (const s of shots) {
      if (s.status === 'done') continue;
      total += at({ kind: 'shot', id: s.id }, est({ kind: 'video', maker: m.maker, size: m.size, seconds: m.seconds, cold: firstShot }));
      firstShot = false;
    }
    if (!m.render || m.render.stale || shots.some((s) => s.status !== 'done')) total += FINAL_SECONDS;
    return Math.round(total);
  }

  /** How long a movie like this would take, before it exists (the Make button shows it). */
  function estimate(body = {}) {
    const maker = body.maker === 'h3-max' ? 'h3-max' : 'ltx';
    const lead = LEAD_MODES.includes(body.lead?.mode) ? body.lead.mode : 'auto';
    const m = {
      length: clampLength(body.length),
      seconds: SHOT_SECONDS,
      size: body.size === 'landscape' ? 'landscape' : 'portrait',
      maker,
      continuity: body.continuity === 'chain' || !KEYFRAME_MAKERS.includes(maker) ? 'chain' : 'keyframes',
      lead: { mode: lead },
      frames: [],
      shots: [],
      render: null,
    };
    return { seconds: remainingSeconds(m), shots: shotCount(m.length, m.seconds), shotSeconds: m.seconds };
  }

  const setStatus = async (id, fn) => {
    const m = await read(id);
    if (!m) return null;
    fn(m);
    await write(m);
    return m;
  };

  /** A step went wrong: say what, on the thing that failed, and stop. */
  const fail = (id, message, mark) =>
    setStatus(id, (m) => {
      mark?.(m);
      m.phase = 'error';
      m.error = message;
    });

  /** The prompt for one shot, written the way its maker (LTX or H3) wants it, with the shot's spoken or sung lines inside. */
  function shotPrompt(m, shot) {
    return shotPromptFor(m.maker, {
      look: m.look.trim(),
      lead: m.lead.mode === 'ai' ? m.lead.description || '' : '',
      action: shot.prompt.trim(),
      says: shot.says || '',
      sound: soundOf(m),
      seconds: m.seconds,
      keyframes: m.continuity === 'keyframes',
    });
  }

  function framePrompt(m, frame, k) {
    const shape = m.size === 'portrait' ? 'Vertical 9:16 film still, framed for a phone.' : 'Wide 16:9 film still.';
    const look = m.look.trim() ? `Style: ${m.look.trim()}.` : '';
    if (m.lead.itemId) return `The person from the picture, with exactly the same face, hair and clothes, in a new scene: ${frame.prompt} ${look} ${shape}`.trim();
    if (k > 0 && m.continuity === 'keyframes') return `A later moment of the same film, with the same place, characters and style: ${frame.prompt} ${look} ${shape}`.trim();
    const lead = m.lead.mode === 'ai' && m.lead.description ? `The lead: ${m.lead.description}.` : '';
    return [shape, look, lead, frame.prompt].filter(Boolean).join(' ');
  }

  /** Story, lead, storyboard, (your check), shots, final cut: one step per turn, in the background. */
  async function autoLoop(id, state) {
    try {
      for (;;) {
        let m = await read(id);
        if (!m || state.stop || state.removed) return;

        // 1. The story.
        if (!m.shots.some((s) => s.prompt.trim())) {
          await setStatus(id, (x) => (x.phase = 'story'));
          // The writer uses the graphics card too: a Lab movie lets your job go first.
          await yieldToOwner(id, state);
          if (state.stop || state.removed) return;
          try {
            m = await read(id);
            await story(m);
            await write(m);
          } catch (e) {
            await fail(id, e.message);
            return;
          }
          continue;
        }

        // 2. The lead's reference picture.
        if (m.lead.mode === 'auto') {
          await setStatus(id, (x) => (x.lead.mode = x.lead.description ? 'ai' : 'none'));
          continue;
        }
        if (m.lead.mode === 'photo' && !m.lead.itemId) {
          if (!m.lead.jobId) {
            await fail(id, 'Add a photo of your lead, or let the AI design one.', (x) => (x.lead.status = 'error'));
            return;
          }
          await setStatus(id, (x) => (x.phase = 'lead'));
          // The photo's job was started when it was added: wait for it here.
          while (!state.stop && !state.removed) {
            const cur = await read(id);
            if (!cur) return;
            if (await settleLeadPhoto(cur)) {
              await write(cur);
              break;
            }
            await new Promise((r) => setTimeout(r, pollMs));
          }
          const after = await read(id);
          if (!after || state.stop || state.removed) return;
          if (!after.lead.itemId) {
            await fail(id, after.lead.error || 'The photo of your lead could not be used.');
            return;
          }
          continue;
        }
        if (m.lead.mode === 'ai' && !m.lead.itemId) {
          await setStatus(id, (x) => {
            x.phase = 'lead';
            x.lead.status = 'making';
          });
          const prompt = `Character reference picture of ${m.lead.description || 'the main character'}. From the knees up, facing the camera, plain light grey background, soft even light. ${m.look}`.trim();
          const job = await waitJob(id, state, { kind: 'image', maker: 'qwen', prompt, size: PICTURE[m.size] }, { kind: 'lead', id: 'lead' });
          if (state.removed) return;
          const ok = job.status === 'done' && job.item;
          await setStatus(id, (x) => Object.assign(x.lead, ok ? { status: 'done', itemId: job.item.id, error: null } : { status: job.status === 'stopped' ? 'todo' : 'error', error: job.error || null }));
          if (!ok) {
            if (job.status !== 'stopped') await fail(id, `The lead could not be made: ${job.error || 'unknown problem'}`);
            return;
          }
          continue;
        }

        // 3. The storyboard: the pictures the shots start and end on.
        const neededIds = new Set(m.continuity === 'keyframes' ? m.shots.filter((s) => s.status !== 'done').flatMap((s) => s.frames || []) : [m.frames[0]?.id]);
        // The first picture comes first: the others are made from it when there is no lead.
        const k = m.frames.findIndex((f, i) => !f.itemId && (neededIds.has(f.id) || (i === 0 && !m.lead.itemId && m.continuity === 'keyframes' && neededIds.size)));
        if (k >= 0) {
          const frame = m.frames[k];
          await setStatus(id, (x) => {
            x.phase = 'storyboard';
            const f = x.frames.find((y) => y.id === frame.id);
            if (f) Object.assign(f, { status: 'making', error: null });
          });
          const req = { kind: 'image', prompt: framePrompt(m, frame, k), size: PICTURE[m.size] };
          if (m.lead.itemId) Object.assign(req, { maker: 'edit', fromItem: m.lead.itemId });
          else if (k > 0 && m.continuity === 'keyframes') Object.assign(req, { maker: 'edit', fromItem: m.frames[0].itemId });
          else req.maker = 'qwen';
          const job = await waitJob(id, state, req, { kind: 'frame', id: frame.id });
          if (state.removed) return;
          const ok = job.status === 'done' && job.item;
          await setStatus(id, (x) => {
            const f = x.frames.find((y) => y.id === frame.id);
            if (f) Object.assign(f, ok ? { status: 'done', itemId: job.item.id, error: null } : { status: job.status === 'stopped' ? 'todo' : 'error', error: job.status === 'stopped' ? null : job.error || 'The picture failed.' });
          });
          if (!ok) {
            if (job.status !== 'stopped') await fail(id, `Storyboard picture ${k + 1} could not be made: ${job.error || 'unknown problem'}`);
            return;
          }
          continue;
        }

        // 4. Your check, when you asked for one.
        if (m.reviewStoryboard && !m.approved) {
          state.waiting = true;
          await setStatus(id, (x) => (x.phase = 'review'));
          return;
        }

        // 5. The shots.
        const idx = m.shots.findIndex((s) => s.status !== 'done' && s.prompt.trim());
        if (idx >= 0) {
          const shot = m.shots[idx];
          const req = { kind: 'video', maker: m.maker, prompt: shotPrompt(m, shot), size: m.size, seconds: m.seconds };
          const byId = (fid) => m.frames.find((f) => f.id === fid);
          const [a, b] = (shot.frames || []).map(byId);
          if (m.continuity === 'keyframes' && a?.itemId && b?.itemId) Object.assign(req, { fromItem: a.itemId, toItem: b.itemId });
          else {
            // No storyboard pictures for this one: carry on from the last frame of the shot before.
            const prev = idx > 0 ? m.shots[idx - 1] : null;
            if (prev?.itemId && (await studio.item(prev.itemId))) req.fromLastFrameOf = prev.itemId;
            else if (m.frames[0]?.itemId) req.fromItem = m.frames[0].itemId;
          }
          await setStatus(id, (x) => {
            x.phase = 'shots';
            const s = x.shots.find((y) => y.id === shot.id);
            if (s) Object.assign(s, { status: 'making', error: null });
          });
          const job = await waitJob(id, state, req, { kind: 'shot', id: shot.id });
          if (state.removed) return;
          const ok = job.status === 'done' && job.item;
          await setStatus(id, (x) => {
            const s = x.shots.find((y) => y.id === shot.id);
            if (s) Object.assign(s, ok ? { status: 'done', itemId: job.item.id, error: null } : { status: job.status === 'stopped' ? 'todo' : 'error', error: job.status === 'stopped' ? null : job.error || 'The shot failed.' });
            if (ok) staleCut(x);
          });
          if (!ok) {
            if (job.status !== 'stopped') await fail(id, `Shot ${idx + 1} could not be made: ${job.error || 'unknown problem'}`);
            return;
          }
          continue;
        }

        // 6. The final cut.
        if (!m.render || m.render.stale) {
          await setStatus(id, (x) => (x.phase = 'final'));
          state.step = { kind: 'final', id: 'final' };
          try {
            await render(id);
          } catch (e) {
            await fail(id, e.message);
            return;
          }
          state.step = null;
        }
        await setStatus(id, (x) => {
          x.phase = 'done';
          x.error = null;
        });
        return;
      }
    } finally {
      await finishRun(id, state);
    }
  }

  /** Every gallery item a movie was made of: the lead, the storyboard, the shots and the cut. */
  const itemsOf = (m) => [m.lead?.itemId, ...(m.frames || []).map((f) => f.itemId), ...(m.shots || []).map((s) => s.itemId), m.render?.itemId].filter(Boolean);

  /** You kept a Lab movie: it moves into soReal (and its pictures and shots into your gallery), to open and change like your own. */
  async function adopt(id) {
    const m = await read(id);
    if (!m?.lab) return false;
    for (const itemId of itemsOf(m)) await studio.promote?.(itemId).catch(() => false);
    delete m.lab;
    delete m.background;
    await write(m);
    return true;
  }

  /** True while the other machine is making a movie with this maker (its files must stay). */
  async function usedElsewhere(makerId) {
    return (await list()).some((m) => m.running && m.runningOn !== machine && m.maker === makerId);
  }

  /** True while a movie is making shots (keeps the machine from turning off between shots). */
  const busy = () => running.size > 0;

  return { list, create, get, update, remove, run, stop, render, plan, leadPhoto, estimate, busy, ownerBusy, usedElsewhere, adopt };
}
