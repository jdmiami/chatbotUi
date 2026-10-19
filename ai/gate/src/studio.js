// Image and video maker ("studio") for the AI machine: downloads the model files, runs jobs on the
// local ComfyUI (127.0.0.1:8188, never exposed), tracks their progress, keeps a gallery on the
// network volume and serves the results. Everything that creates something goes through
// createJob(), which applies the one content rule (no sexual content involving minors).
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { lastFrameArgs, runFfmpeg } from './movies.js';
import { pipeline } from 'node:stream/promises';
import {
  MAKERS,
  NOCT_NEGATIVE,
  FILES,
  STUDIO_FILES,
  editWorkflow,
  h3Workflow,
  imageWorkflow,
  kreaWorkflow,
  qwenWorkflow,
  upscaleWorkflow,
  videoWorkflow,
} from './workflows.js';

/** Longest a single job may keep the machine awake (the slowest videos take about 20 minutes). */
const STUCK_JOB_MS = 60 * 60_000;

// ---------------------------------------------------------------- how long jobs should take
// Measured on the AI machine's GPU (A40). Each maker's time is per "unit": one picture at its usual
// size, or one second of 720p video. The machine replaces these with its own timings as it works.
const BASE_MS = {
  qwen: 45_000,
  'qwen-real': 45_000,
  anime: 45_000,
  'krea-real': 20_000,
  edit: 60_000,
  outfit: 60_000,
  angles: 60_000,
  sharpen: 15_000,
  ltx: 40_000,
  'h3-max': 90_000,
};
/** Loading a maker's models from the volume, the first time (or after another maker ran). */
const LOAD_MS = { image: 30_000, video: 90_000 };
/** A job is "slow" past 1.5x its usual time, and stopped and tried again past its budget. */
const SLOW = 1.5;
export const budgetFor = (expectedMs) => Math.max(expectedMs * 3, expectedMs + 5 * 60_000);
/** No word from the maker about a running job for this long means it froze. */
const STALL_MS = 10 * 60_000;
/** The maker can be down this long (it restarts itself after a crash) before a job gives up. */
const DOWN_MS = 6 * 60_000;
/** Each job is tried at most twice. */
const MAX_ATTEMPTS = 2;

/** The job's size in units (see BASE_MS). */
export function jobUnits({ kind, maker, width, height, seconds }) {
  if (kind === 'video') return Math.max(1, (seconds || 5) * ((width || 1280) * (height || 720)) / (1280 * 720));
  if (maker === 'krea-real') return Math.max(0.5, ((width || 1024) * (height || 1536)) / (1024 * 1536));
  if (BASE_MS[maker] && ['qwen', 'qwen-real', 'anime'].includes(maker)) return Math.max(0.5, ((width || 1328) * (height || 1328)) / (1328 * 1328));
  return 1;
}

/** Errors worth one more try after freeing the graphics card (out of memory, a crash). */
const OOM = /out of memory|outofmemory|cuda error|cudnn|cublas|allocat(e|ion) .*memory|hip error|device-side assert/i;

// ---------------------------------------------------------------- content rule

const MINOR = [
  /\b(child|children|kid|kids|kiddie|minor|minors|underage|under-age|preteen|pre-teen|tween|toddler|infant|baby|babies|newborn)\b/,
  /\b(little|young|small)\s+(girl|boy|girls|boys|child|kid|teen|teens)\b/,
  /\b(school\s*girl|school\s*boy|schoolgirl|schoolboy|elementary|middle\s+school|junior\s+high|kindergarten|grade\s*school|prepubescent|pubescent|youngster)s?\b/,
  /\b([1-9]|1[0-7])\s*(yo|y\/o|y\.o\.?|yrs?|years?)(\s*-?\s*old)?\b/,
  /\b(age|aged)\s*([1-9]|1[0-7])\b/,
  /\b(young|early)\s+teens?\b/,
];
const ALWAYS = /\b(loli|lolis|lolicon|shota|shotacon|pedo|pedophil\w*|paedo\w*|cp|csam|jailbait)\b/;
const SEXUAL =
  /\b(nude|nudes|naked|nsfw|sex|sexual|sexy|porn\w*|explicit|erotic\w*|topless|bottomless|breasts?|boobs?|nipples?|genital\w*|penis|vagina|pussy|cock|dick|orgasm\w*|masturbat\w*|lingerie|undress\w*|strip\w*|seductive|sensual|fetish|bdsm|cum|blowjob|handjob|intercourse|aroused|horny|lewd|hentai|bikini|panties|underwear|thong|spread\s+legs|provocative|intimate)\b/;

/** True when a prompt asks for sexual content involving minors. Kept deliberately simple and strict. */
export function blockedPrompt(text) {
  const t = String(text || '').toLowerCase().replace(/[_*~`]/g, ' ');
  if (ALWAYS.test(t)) return true;
  return SEXUAL.test(t) && MINOR.some((re) => re.test(t));
}
export const BLOCKED_MESSAGE = "This can't be made: sexual content involving minors is never allowed.";

/** Photos you upload are often of real people: they can't be made sexual or undressed. */
const UNDRESS = /\b(undress\w*|unclothe\w*|remove\s+(her|his|their|the)?\s*(clothes|clothing|shirt|top|dress|bra|pants|underwear)|(?:take|takes|taking|took)\s+off\s+(her|his|their)?\s*(clothes|clothing)|without\s+clothes|see[-\s]?through|x-?ray)\b/;
export function blockedForPhoto(text) {
  const t = String(text || '').toLowerCase().replace(/[_*~`]/g, ' ');
  return SEXUAL.test(t) || UNDRESS.test(t);
}
export const PHOTO_MESSAGE = "Photos you upload can't be made sexual or have clothes removed: they may show real people. Pictures made here from a description can.";

// ---------------------------------------------------------------- helpers

const SIZES = {
  image: { square: [1328, 1328], portrait: [1104, 1472], landscape: [1472, 1104], wide: [1664, 928], tall: [928, 1664] },
  // LTX works in multiples of 64 here (half size, then 2x): 720 would come out as 704 anyway.
  video: { landscape: [1280, 704], portrait: [704, 1280], square: [960, 960] },
  // Krea 2 and H3 like their own sizes (H3: multiples of 32).
  krea: { square: [1024, 1024], portrait: [1024, 1536], landscape: [1536, 1024], wide: [1536, 864], tall: [864, 1536] },
  h3: { landscape: [1280, 704], portrait: [704, 1280], square: [960, 960] },
};
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.webm': 'video/webm' };
const newId = () => crypto.randomBytes(9).toString('base64url');

function sniffImage(buf) {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return '.png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return '.jpg';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return '.webp';
  return null;
}

/** A PNG's width and height from its header (ComfyUI saves pictures as PNG); null for anything else. */
export async function pngSize(file) {
  const h = await fsp.open(file, 'r').catch(() => null);
  if (!h) return null;
  try {
    const buf = Buffer.alloc(24);
    await h.read(buf, 0, 24, 0);
    if (buf.readUInt32BE(0) !== 0x89504e47 || buf.toString('ascii', 12, 16) !== 'IHDR') return null;
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  } finally {
    await h.close();
  }
}

/** Files ComfyUI lists in a history entry's outputs ({images|gifs|videos|...: [{filename, subfolder, type}]}). */
export function outputFiles(outputs) {
  const found = [];
  for (const node of Object.values(outputs || {})) {
    for (const list of Object.values(node || {})) {
      if (!Array.isArray(list)) continue;
      for (const f of list) if (f && typeof f.filename === 'string' && f.type !== 'temp') found.push(f);
    }
  }
  return found;
}

// ---------------------------------------------------------------- the studio

/**
 * @param {object} o
 *   dir        studio folder on the volume (models/, input/, output/, state)
 *   comfy      ComfyUI base URL
 *   ollama     Ollama base URL (its models are unloaded before a job, to free GPU memory)
 *   files      model files per kind (STUDIO_FILES)
 *   fetchImpl, WebSocketImpl, log, now     (tests)
 */
export function createStudio(o) {
  const dir = o.dir;
  const comfy = o.comfy || 'http://127.0.0.1:8188';
  const ollama = o.ollama || 'http://127.0.0.1:11434';
  const files = o.files || STUDIO_FILES;
  const f = o.fetchImpl || fetch;
  const WS = o.WebSocketImpl || globalThis.WebSocket;
  const log = o.log || console;
  const now = o.now || Date.now;
  const clientId = `gate-${newId()}`;
  const freeAfterMs = o.freeAfterMs ?? 3 * 60_000;
  // A helper machine shares the main machine's files: it makes things but never downloads or
  // deletes model files (the main machine does that).
  const helper = Boolean(o.helper);
  const ffmpeg = o.ffmpeg || runFfmpeg;

  const jobs = new Map(); // id -> job
  const byPrompt = new Map(); // ComfyUI prompt_id -> job
  const download = { current: null, done: new Set(), error: null, running: false };
  let lastJobEnd = 0;
  let comfyHoldsGpu = false;
  let lastMode = null; // what the last job made (video models are huge)
  let ws = null;

  const modelPath = (file) => path.join(dir, 'models', file.dir, file.name);
  const wantedPath = path.join(dir, 'makers.json');
  let wanted = new Set();
  try {
    wanted = new Set(JSON.parse(fs.readFileSync(wantedPath, 'utf8')).wanted || []);
  } catch {
    /* none yet */
  }
  const makerById = (id) => MAKERS.find((m) => m.id === id) || null;
  // The built-in makers use the studio's own files (tests pass small fake ones).
  const QWEN_KEYS = { qwenUnet: 0, qwenTe: 1, qwenVae: 2 };
  function makerFiles(m) {
    if (m.id === 'ltx') return files.video;
    return m.files.map((k) => (k in QWEN_KEYS ? files.image[QWEN_KEYS[k]] : k.startsWith('style:') ? m.loraFile : FILES[k])).filter(Boolean);
  }
  const kept = () => MAKERS.filter((m) => m.builtIn || wanted.has(m.id));
  /** Every file to keep on the machine, in download order: the built-in image and video makers first. */
  function neededFiles() {
    const seen = new Map();
    for (const kind of ['image', 'video']) for (const file of files[kind]) seen.set(file.name, file);
    for (const m of kept()) for (const file of makerFiles(m)) if (!seen.has(file.name)) seen.set(file.name, file);
    return [...seen.values()];
  }
  const metaDir = path.join(dir, 'output', 'orbit');

  // ---- model downloads (resumable, one at a time; images first)
  async function haveFile(file) {
    const st = await fsp.stat(modelPath(file)).catch(() => null);
    return Boolean(st && (!file.size || st.size === file.size));
  }

  async function fetchFile(file) {
    const dest = modelPath(file);
    const part = `${dest}.part`;
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    const have = (await fsp.stat(part).catch(() => null))?.size || 0;
    const url = `https://huggingface.co/${file.repo}/resolve/main/${file.path.split('/').map(encodeURIComponent).join('/')}`;
    const res = await f(url, { headers: have ? { range: `bytes=${have}-` } : {}, redirect: 'follow' });
    if (!res.ok || !res.body) throw new Error(`download ${file.name}: ${res.status}`);
    const resumed = res.status === 206;
    download.current = { name: file.name, completed: resumed ? have : 0, total: file.size || Number(res.headers.get('content-length')) || 0 };
    const counter = new TransformStream({
      transform(chunk, ctrl) {
        download.current.completed += chunk.byteLength;
        ctrl.enqueue(chunk);
      },
    });
    await pipeline(Readable.fromWeb(res.body.pipeThrough(counter)), fs.createWriteStream(part, { flags: resumed ? 'a' : 'w' }));
    const size = (await fsp.stat(part)).size;
    if (file.size && size !== file.size) throw new Error(`download ${file.name}: got ${size} of ${file.size} bytes`);
    await fsp.rename(part, dest);
  }

  async function downloadAll() {
    if (download.running) return;
    download.running = true;
    try {
      // The list is read again after every file, so makers installed meanwhile are picked up.
      for (;;) {
        let next = null;
        for (const file of neededFiles()) {
          if (download.done.has(file.name)) continue;
          if (await haveFile(file)) download.done.add(file.name);
          else {
            next = file;
            break;
          }
        }
        if (!next) break;
        try {
          await fetchFile(next);
          download.error = null;
          download.done.add(next.name);
        } catch (err) {
          download.error = err.message;
          log.warn?.(`[studio] ${err.message}; retrying in 30s`);
          await new Promise((r) => setTimeout(r, o.retryMs ?? 30_000));
        }
      }
    } finally {
      download.current = null;
      download.running = false;
    }
  }

  async function ready(kind) {
    for (const file of files[kind]) if (!(await haveFile(file))) return false;
    return true;
  }

  // ---- the maker store
  function bytesDone(list) {
    let total = 0;
    let done = 0;
    for (const file of list) {
      total += file.size || 0;
      if (download.done.has(file.name)) done += file.size || 0;
      else if (download.current?.name === file.name) done += download.current.completed;
    }
    return { total, done };
  }

  async function makers() {
    const out = [];
    for (const m of MAKERS) {
      const list = makerFiles(m);
      let installed = true;
      for (const file of list) if (!(await haveFile(file))) installed = false;
      const { total, done } = bytesDone(list);
      out.push({
        id: m.id,
        kind: m.kind,
        name: m.name,
        blurb: m.blurb,
        for: m.for || null,
        twoImages: Boolean(m.twoImages),
        builtIn: Boolean(m.builtIn),
        wanted: Boolean(m.builtIn || wanted.has(m.id)),
        installed,
        size: total,
        percent: installed ? 100 : total ? Math.min(99, Math.floor((done / total) * 100)) : 0,
      });
    }
    return out;
  }

  async function saveWanted() {
    await fsp.writeFile(wantedPath, JSON.stringify({ wanted: [...wanted] }));
  }

  async function installMaker(id) {
    if (helper) throw Object.assign(new Error('Add makers from your main AI machine.'), { status: 409 });
    const m = makerById(id);
    if (!m) throw Object.assign(new Error('No such maker.'), { status: 404 });
    if (m.kind === 'style' && !(m.for && (makerById(m.for)?.builtIn || wanted.has(m.for)))) {
      wanted.add(m.for);
    }
    wanted.add(id);
    await saveWanted();
    void downloadAll();
    return makers();
  }

  async function removeMaker(id) {
    if (helper) throw Object.assign(new Error('Remove makers from your main AI machine.'), { status: 409 });
    const m = makerById(id);
    if (!m) throw Object.assign(new Error('No such maker.'), { status: 404 });
    if (m.builtIn) throw Object.assign(new Error('This maker comes with the machine and stays.'), { status: 400 });
    if (active().some((j) => j.maker === id)) throw Object.assign(new Error('It is making something right now. Try again when that is done.'), { status: 409 });
    // Both machines use the same model files: keep them while the helper is making a movie with it.
    if (await o.inUseElsewhere?.(id)) throw Object.assign(new Error('Your helper machine is making a movie with it. Try again when that is done.'), { status: 409 });
    wanted.delete(id);
    // Styles go with their maker.
    for (const s of MAKERS) if (s.for === id) wanted.delete(s.id);
    await saveWanted();
    const keep = new Set(neededFiles().map((f) => f.name));
    for (const file of makerFiles(m)) {
      if (keep.has(file.name)) continue;
      download.done.delete(file.name);
      await fsp.rm(modelPath(file), { force: true });
      await fsp.rm(`${modelPath(file)}.part`, { force: true });
    }
    return makers();
  }

  async function makerReady(m) {
    for (const file of makerFiles(m)) if (!(await haveFile(file))) return false;
    return true;
  }

  function kindProgress(kind) {
    let total = 0;
    let done = 0;
    for (const file of files[kind]) {
      total += file.size || 0;
      if (download.done.has(file.name)) done += file.size || 0;
      else if (download.current?.name === file.name) done += download.current.completed;
    }
    return total ? Math.min(100, Math.floor((done / total) * 100)) : 0;
  }

  // ---- ComfyUI
  async function comfyJson(p, init) {
    const res = await f(`${comfy}${p}`, { ...init, signal: AbortSignal.timeout(init?.timeout ?? 10_000) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = body?.error?.message || JSON.stringify(body?.node_errors || body).slice(0, 300);
      // A 4xx means ComfyUI read the job and refused it (a recipe problem): trying again won't help.
      throw Object.assign(new Error(`ComfyUI ${p}: ${res.status} ${detail}`), { comfyStatus: res.status, nodeErrors: body?.node_errors || null });
    }
    return body;
  }
  const comfyUp = () => comfyJson('/system_stats', { timeout: 3000 }).then(() => true, () => false);

  async function setupState() {
    return (await fsp.readFile(path.join(dir, helper ? 'state-helper' : 'state'), 'utf8').catch(() => 'installing')).trim();
  }

  let wsOpen = false;
  function connectWs() {
    if (!WS || ws) return;
    try {
      ws = new WS(`${comfy.replace(/^http/, 'ws')}/ws?clientId=${clientId}`);
    } catch {
      ws = null;
      return;
    }
    ws.onopen = () => {
      wsOpen = true;
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      const job = msg.data?.prompt_id && byPrompt.get(msg.data.prompt_id);
      if (!job) return;
      job.lastEventAt = now();
      if (msg.type === 'execution_start' || msg.type === 'executing') job.status = 'running';
      if (msg.type === 'progress') onProgress(job, String(msg.data.node), msg.data.value, msg.data.max);
      if (msg.type === 'execution_error') void failed(job, msg.data.exception_message || 'The job failed.');
      if (msg.type === 'execution_success') void finish(job);
      if (msg.type === 'execution_interrupted') void finish(job, 'Stopped.');
    };
    const drop = () => {
      ws = null;
      wsOpen = false;
    };
    ws.onclose = drop;
    ws.onerror = drop;
  }

  // How far along a job is: each sampling pass covers part of the bar.
  const STAGES = { image: { 7: [0, 95] }, video: { 38: [5, 70], 47: [70, 92], 50: [92, 99] }, h3: { 10: [5, 90], 11: [90, 99] }, upscale: { 3: [0, 95] } };
  function onProgress(job, node, value, max) {
    const stage = STAGES[job.stages || job.kind]?.[node];
    if (!stage || !max) return;
    const pct = Math.floor(stage[0] + ((stage[1] - stage[0]) * value) / max);
    job.progress = Math.max(job.progress, Math.min(99, pct));
  }

  // GPU memory: the chat models and the image/video models don't fit together.
  async function unloadChatModels() {
    const ps = await f(`${ollama}/api/ps`, { signal: AbortSignal.timeout(5000) })
      .then((r) => r.json())
      .catch(() => null);
    for (const m of ps?.models || []) {
      await f(`${ollama}/api/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: m.name, keep_alive: 0 }),
        signal: AbortSignal.timeout(30_000),
      }).catch(() => {});
    }
  }
  async function releaseGpu() {
    if (!comfyHoldsGpu || active().length || now() - lastJobEnd < freeAfterMs) return;
    comfyHoldsGpu = false;
    await comfyJson('/free', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ unload_models: true, free_memory: true }) }).catch(
      () => {},
    );
  }

  // ---- jobs
  // The gate keeps the queue: one job at a time goes to ComfyUI, so each job's time is its own, the
  // machine can tell when one takes too long, and a stuck one can be stopped and tried again.
  const active = () => [...jobs.values()].filter((j) => j.status === 'queued' || j.status === 'running');
  /** Jobs waiting their turn, in order (a job being tried again goes first). */
  const waiting = () =>
    [...jobs.values()].filter((j) => j.status === 'queued' && !j.promptId).sort((a, b) => a.queuedAt - b.queuedAt || a.seq - b.seq);
  /** The job ComfyUI is working on (or about to start). */
  const inFlight = () => [...jobs.values()].find((j) => j.promptId && (j.status === 'queued' || j.status === 'running')) || null;
  let seq = 0;
  let fixing = 0;
  let loadedMaker = null; // the maker whose models ComfyUI has in memory

  // Learned timings (ms per unit), kept on the volume.
  const timingsPath = path.join(dir, helper ? 'timings-helper.json' : 'timings.json');
  let timings = {};
  try {
    timings = JSON.parse(fs.readFileSync(timingsPath, 'utf8')) || {};
  } catch {
    /* none yet */
  }
  // Learned separately for runs that load the models first ("maker:cold") and runs that don't.
  const timingKey = (maker, cold) => (cold ? `${maker}:cold` : maker);
  function expectedMs(job, cold = job.cold ?? loadedMaker !== job.maker) {
    const units = jobUnits(job);
    const guess = (BASE_MS[job.maker] ?? 60_000) * units + (cold ? LOAD_MS[job.kind] : 0);
    const learned = Number(timings[timingKey(job.maker, cold)]) * units;
    return Math.round(Number.isFinite(learned) && learned > 0 ? Math.min(guess * 5, Math.max(guess * 0.2, learned)) : guess);
  }
  async function learn(job) {
    if (!job.startedAt || job.attempts > 1) return;
    const sample = (now() - job.startedAt) / jobUnits(job);
    if (!(sample > 0)) return;
    const key = timingKey(job.maker, job.cold);
    const prev = Number(timings[key]);
    timings[key] = Math.round(Number.isFinite(prev) && prev > 0 ? prev * 0.7 + sample * 0.3 : sample);
    await fsp.writeFile(timingsPath, JSON.stringify(timings)).catch(() => {});
  }

  /** A line about what the machine did on its own, in plain words (shown with the job). */
  function note(job, text) {
    job.notes = [...(job.notes || []), text].slice(-6);
    log.warn?.(`[studio] job ${job.id}: ${text}`);
  }

  function publicJob(j) {
    const queue = waiting();
    const current = inFlight();
    const pos = j.status === 'queued' && !j.promptId ? queue.indexOf(j) + 1 : 0;
    const expected = j.expectedMs || expectedMs(j);
    const elapsed = j.startedAt && (j.status === 'running' || j.status === 'queued') ? now() - j.startedAt : 0;
    // Waiting: what is left of the current job plus everything ahead of this one.
    let eta = null;
    if (j.status === 'running' || (j.status === 'queued' && j.promptId)) eta = Math.max(0, expected - elapsed);
    else if (pos) {
      eta = current ? Math.max(0, (current.expectedMs || expectedMs(current)) - (current.startedAt ? now() - current.startedAt : 0)) : 0;
      let prev = current?.maker ?? loadedMaker;
      for (const ahead of queue.slice(0, pos)) {
        eta += expectedMs(ahead, ahead.maker !== prev);
        prev = ahead.maker;
      }
    }
    return {
      id: j.id,
      kind: j.kind,
      maker: j.maker || null,
      prompt: j.prompt,
      status: j.status,
      progress: j.progress,
      error: j.error || null,
      createdAt: j.createdAt,
      startedAt: j.startedAt ? new Date(j.startedAt).toISOString() : null,
      finishedAt: j.finishedAt || null,
      position: pos,
      expectedSeconds: Math.round(expected / 1000),
      etaSeconds: eta == null ? null : Math.round(eta / 1000),
      slow: Boolean(elapsed && elapsed > expected * SLOW),
      attempt: j.attempts || 1,
      notes: j.notes || [],
      item: j.item || null,
    };
  }

  /** Use a picture from the gallery as a video's first frame ("make it move"). */
  async function copyFromGallery(id) {
    const it = await readItem(id);
    if (!it || it.kind !== 'image') throw Object.assign(new Error('That picture is no longer in your gallery.'), { status: 404 });
    const src = path.resolve(path.join(dir, 'output'), it.file);
    if (!src.startsWith(path.join(dir, 'output') + path.sep)) throw Object.assign(new Error('Not found'), { status: 404 });
    const name = `orbit-${newId()}${path.extname(src).toLowerCase() || '.png'}`;
    await fsp.mkdir(path.join(dir, 'input'), { recursive: true });
    await fsp.copyFile(src, path.join(dir, 'input', name));
    return name;
  }

  /** The last frame of a gallery video, as a picture to start from (soReal: the next shot). */
  async function lastFrameOf(id) {
    const it = await readItem(id);
    if (!it || it.kind !== 'video') throw Object.assign(new Error('That video is no longer in your gallery.'), { status: 404 });
    const src = path.resolve(path.join(dir, 'output'), it.file);
    if (!src.startsWith(path.join(dir, 'output') + path.sep)) throw Object.assign(new Error('Not found'), { status: 404 });
    const name = `orbit-${newId()}-last.png`;
    await fsp.mkdir(path.join(dir, 'input'), { recursive: true });
    await ffmpeg(lastFrameArgs(src, path.join(dir, 'input', name)), { timeoutMs: 60_000 });
    return name;
  }

  async function saveUpload(dataUrl) {
    const m = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl || ''));
    if (!m) throw Object.assign(new Error('The starting picture must be a PNG, JPEG or WebP image.'), { status: 400 });
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 20 * 1024 * 1024) throw Object.assign(new Error('The starting picture is too large (20 MB max).'), { status: 413 });
    const ext = sniffImage(buf);
    if (!ext) throw Object.assign(new Error('That file is not a picture.'), { status: 400 });
    const name = `orbit-${newId()}${ext}`;
    await fsp.mkdir(path.join(dir, 'input'), { recursive: true });
    await fsp.writeFile(path.join(dir, 'input', name), buf);
    return name;
  }

  /**
   * Start a job. req: { kind: 'image'|'video', maker?, prompt, size?, seconds?, style?,
   *   image? (data URL), images? (data URLs, for edits), fromItem? (gallery id) }.
   * Throws errors with .status for bad requests.
   */
  async function createJob(req) {
    const maker = req.maker ? makerById(String(req.maker)) : makerById(req.kind === 'video' ? 'ltx' : 'qwen');
    if (!maker || maker.kind === 'style') throw Object.assign(new Error('No such maker.'), { status: 400 });
    const mode = maker.kind; // image | video | edit | upscale
    const kind = mode === 'video' ? 'video' : 'image';
    let prompt = String(req.prompt || '').trim().slice(0, 4000);
    if (!prompt && mode !== 'upscale') throw Object.assign(new Error(mode === 'edit' ? 'Describe the change.' : 'Describe what to make.'), { status: 400 });
    if (blockedPrompt(prompt)) throw Object.assign(new Error(BLOCKED_MESSAGE), { status: 422, blocked: true });
    const uploads = [...(req.image ? [req.image] : []), ...(Array.isArray(req.images) ? req.images : [])].slice(0, 2);
    // A gallery picture or video that came from someone's photo keeps the photo rule.
    const fromId = req.fromLastFrameOf || req.fromItem;
    const source = fromId ? await readItem(String(fromId)) : null;
    const photo = uploads.length > 0 || Boolean(source?.photo);
    if (photo && blockedForPhoto(prompt)) throw Object.assign(new Error(PHOTO_MESSAGE), { status: 422, blocked: true });
    if (!(await makerReady(maker))) {
      const pct = (await makers()).find((m) => m.id === maker.id)?.percent ?? 0;
      const what = maker.builtIn ? `The ${maker.name} maker is still downloading (${pct}%)` : `${maker.name} is ${wanted.has(maker.id) ? `still downloading (${pct}%)` : 'not installed'}`;
      throw Object.assign(new Error(`${what}. Try again when it's done.`), { status: 503 });
    }
    let style = null;
    if (req.style) {
      const s = makerById(String(req.style));
      if (!s || s.kind !== 'style' || s.for !== maker.id) throw Object.assign(new Error('That style is not for this maker.'), { status: 400 });
      if (!(await makerReady(s))) throw Object.assign(new Error(`The ${s.name} style is not installed yet.`), { status: 503 });
      style = s.loraFile.name;
    }
    if (!(await comfyUp())) throw Object.assign(new Error('The image and video maker is still starting. Try again in a minute.'), { status: 503 });

    const id = newId();
    const prefix = `orbit/${kind}-${id}`;
    // Pictures to start from: uploads, or a picture from the gallery.
    const inputs = [];
    if (req.fromLastFrameOf) inputs.push(await lastFrameOf(String(req.fromLastFrameOf)));
    else if (req.fromItem) inputs.push(await copyFromGallery(String(req.fromItem)));
    for (const u of uploads) inputs.push(await saveUpload(u));
    const need = mode === 'edit' ? (maker.twoImages ? 2 : 1) : mode === 'upscale' ? 1 : 0;
    if (inputs.length < need) {
      throw Object.assign(new Error(maker.twoImages ? 'Add two pictures: the person first, then the outfit.' : 'Add the picture to start from.'), { status: 400 });
    }

    let workflow;
    let width;
    let height;
    let seconds;
    let stages = null;
    if (mode === 'video') {
      seconds = Math.min(10, Math.max(2, Math.round(Number(req.seconds) || 5)));
      const image = inputs[0] || null;
      if (maker.id === 'h3-max') {
        // H3 is trained on clips of about 5 to 15 s; shorter ones come out poorly.
        seconds = Math.max(5, seconds);
        [width, height] = SIZES.h3[req.size] || SIZES.h3.landscape;
        workflow = h3Workflow({ prompt, width, height, seconds, image, prefix });
        stages = 'h3';
      } else {
        [width, height] = SIZES.video[req.size] || SIZES.video.landscape;
        workflow = videoWorkflow({ prompt, width, height, seconds, image, prefix });
      }
    } else if (mode === 'edit') {
      const lora = maker.lora ? FILES[maker.lora].name : null;
      if (maker.id === 'angles' && !prompt.startsWith('<mva>')) prompt = `<mva> ${prompt}`;
      workflow = editWorkflow({ prompt, images: inputs.slice(0, need), lora, prefix });
    } else if (mode === 'upscale') {
      prompt = prompt || 'Sharpened 4×';
      workflow = upscaleWorkflow({ image: inputs[0], prefix });
      stages = 'upscale';
    } else if (maker.id === 'krea-real') {
      [width, height] = SIZES.krea[req.size] || SIZES.krea.portrait;
      workflow = kreaWorkflow({ prompt, width, height, style, prefix });
    } else {
      [width, height] = SIZES.image[req.size] || SIZES.image.square;
      workflow =
        maker.id === 'qwen'
          ? imageWorkflow({ prompt, width, height, prefix })
          : qwenWorkflow({ unet: FILES[maker.files[0]].name, prompt, width, height, cfg: 3, negative: NOCT_NEGATIVE, prefix });
    }

    const job = {
      id,
      kind,
      maker: maker.id,
      mode,
      stages,
      prompt,
      width,
      height,
      seconds,
      fromImage: inputs.length > 0,
      photo,
      workflow,
      status: 'queued',
      progress: 0,
      attempts: 1,
      notes: [],
      seq: ++seq,
      queuedAt: now(),
      createdAt: new Date(now()).toISOString(),
    };
    jobs.set(id, job);
    connectWs();
    await dispatch();
    return publicJob(job);
  }

  /** Hand the next waiting job to ComfyUI when it is free. Calls made meanwhile share the one run. */
  let dispatching = null;
  let dispatchAgain = false;
  function dispatch() {
    if (dispatching) {
      dispatchAgain = true;
      return dispatching;
    }
    dispatching = (async () => {
      do {
        dispatchAgain = false;
        while (!fixing && !inFlight()) {
          const job = waiting()[0];
          if (!job || !(await submit(job))) break;
        }
      } while (dispatchAgain);
    })().finally(() => {
      dispatching = null;
    });
    return dispatching;
  }

  /** Send one job to ComfyUI. False when ComfyUI can't take it right now (the job keeps its place). */
  async function submit(job) {
    try {
      await unloadChatModels();
      // Video models are huge (~40 GB staged in memory). Keeping the last job's models while
      // loading the next one runs the machine out of memory, and ComfyUI gets killed (soReal makes
      // shots back to back). So before a video, or after one, start from a clean slate.
      if (comfyHoldsGpu && (job.mode === 'video' || lastMode === 'video')) {
        await comfyJson('/free', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ unload_models: true, free_memory: true }) }).catch(
          () => {},
        );
        loadedMaker = null;
      }
      job.cold = loadedMaker !== job.maker;
      job.expectedMs = expectedMs(job);
      const r = await comfyJson('/prompt', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: job.workflow, client_id: clientId }),
      });
      lastMode = job.mode;
      loadedMaker = job.maker;
      job.promptId = r.prompt_id;
      job.startedAt = now();
      job.lastEventAt = now();
      job.lostChecks = 0;
      byPrompt.set(r.prompt_id, job);
      comfyHoldsGpu = true;
      return true;
    } catch (err) {
      if (err.comfyStatus >= 400 && err.comfyStatus < 500) {
        // ComfyUI read the job and refused it: a problem with the recipe or a missing file.
        log.warn?.(`[studio] job ${job.id} refused: ${err.message}`);
        await finish(job, `The maker couldn't run this job (${err.message.replace(/^ComfyUI \/prompt: /, '')}).`);
        return true;
      }
      // ComfyUI isn't answering; the job keeps its place and the watchdog takes over.
      job.downSince ??= now();
      return false;
    }
  }

  async function finish(job, error) {
    if (job.status === 'done' || job.status === 'error' || job.status === 'stopped') return;
    lastJobEnd = now();
    if (job.promptId) byPrompt.delete(job.promptId);
    if (error) {
      job.status = error === 'Stopped.' ? 'stopped' : 'error';
      job.error = error;
      job.finishedAt = new Date(now()).toISOString();
      void dispatch();
      return;
    }
    try {
      const hist = await comfyJson(`/history/${encodeURIComponent(job.promptId)}`);
      const out = outputFiles(hist[job.promptId]?.outputs)[0];
      if (!out) throw new Error('The job finished without a result.');
      const file = path.posix.join(out.subfolder || '', out.filename);
      // Edits and sharpening make whatever size the picture leads to: read it from the file.
      if (job.kind === 'image' && !(job.width && job.height)) Object.assign(job, (await pngSize(path.join(dir, 'output', file))) || {});
      const item = {
        id: job.id,
        kind: job.kind,
        maker: job.maker,
        prompt: job.prompt,
        width: job.width,
        height: job.height,
        seconds: job.seconds,
        fromImage: job.fromImage,
        photo: job.photo || undefined,
        file,
        createdAt: job.createdAt,
      };
      await fsp.mkdir(metaDir, { recursive: true });
      await fsp.writeFile(path.join(metaDir, `${job.id}.json`), JSON.stringify(item));
      job.item = item;
      job.progress = 100;
      job.status = 'done';
      await learn(job);
    } catch (err) {
      job.status = 'error';
      job.error = err.message;
    }
    job.finishedAt = new Date(now()).toISOString();
    job.workflow = null;
    void dispatch();
  }

  /** ComfyUI reported an error: out of memory is worth one more try on a clean slate. */
  async function failed(job, message) {
    if (OOM.test(message)) return troubleshoot(job, 'oom', message);
    log.warn?.(`[studio] job ${job.id} failed: ${message}`);
    return finish(job, `The maker hit a problem: ${message}`);
  }

  const WHY = {
    overtime: 'It was taking much longer than it should',
    stalled: 'The maker stopped making progress',
    lost: 'The maker restarted and lost the job',
    oom: 'The graphics card ran out of memory',
    down: 'The maker stopped answering',
  };
  const ADVICE = {
    overtime: 'Try a shorter or smaller one, or turn the AI machine off and on again.',
    stalled: 'Turn the AI machine off and on again, then try once more.',
    lost: 'Turn the AI machine off and on again, then try once more.',
    oom: 'Try a smaller size or a shorter video.',
    down: 'Turn the AI machine off and on again, then try once more.',
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  /** True once ComfyUI no longer runs `promptId` (or within `ms` it still does). */
  async function letGo(promptId, ms) {
    const until = now() + ms;
    do {
      const q = await comfyJson('/queue', { timeout: 5000 }).catch(() => null);
      if (q && !(q.queue_running || []).some((e) => e?.[1] === promptId)) return true;
      if (o.fastTroubleshoot) break;
      await sleep(2000);
    } while (now() < until);
    return false;
  }
  async function waitUp(ms) {
    const until = now() + ms;
    do {
      if (await comfyUp()) return true;
      if (o.fastTroubleshoot) break;
      await sleep(3000);
    } while (now() < until);
    return false;
  }
  /** Hard reset: end the ComfyUI process; studio.sh starts a fresh one within seconds. */
  async function restartComfy() {
    if (o.restartComfy) return o.restartComfy();
    const pidFile = path.join(dir, `machine-${helper ? 'helper' : 'main'}`, 'comfy.pid');
    const pid = Number((await fsp.readFile(pidFile, 'utf8').catch(() => '')).trim());
    if (!pid) return false;
    try {
      process.kill(pid, 'SIGKILL');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * The failsafe. Stops a job that is stuck or failed for a reason worth retrying, cleans up, and
   * tries it once more; each step is noted on the job in plain words.
   *   1. stop it in ComfyUI (interrupt); if ComfyUI doesn't let go in 30 s, restart ComfyUI
   *   2. free the graphics card (chat models and ComfyUI's models)
   *   3. try again once, ahead of the queue; a second failure ends the job with what to do next
   */
  async function troubleshoot(job, reason, detail) {
    if (job.fixing || !(job.status === 'queued' || job.status === 'running')) return;
    job.fixing = true;
    fixing++;
    try {
      note(job, `${WHY[reason]}.`);
      if (detail) log.warn?.(`[studio] job ${job.id} ${reason}: ${detail}`);
      const pid = job.promptId;
      if (pid) {
        byPrompt.delete(pid);
        job.promptId = null;
        if (reason !== 'lost' && reason !== 'oom' && (await comfyUp())) {
          await comfyJson('/queue', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ delete: [pid] }) }).catch(() => {});
          await comfyJson('/interrupt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt_id: pid }) }).catch(() => {});
        }
        if (reason !== 'lost' && !(await letGo(pid, 30_000))) {
          note(job, (await restartComfy()) ? 'The maker was frozen, so it was restarted.' : 'The maker was frozen and could not be restarted.');
          if (!(await waitUp(4 * 60_000))) {
            note(job, 'The maker did not come back.');
            return finishFixed(job, reason);
          }
        }
      }
      await unloadChatModels();
      await comfyJson('/free', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ unload_models: true, free_memory: true }) }).catch(() => {});
      comfyHoldsGpu = false;
      loadedMaker = null;
      if (job.attempts >= MAX_ATTEMPTS) return finishFixed(job, reason);
      job.attempts++;
      Object.assign(job, { status: 'queued', progress: 0, startedAt: null, lastEventAt: null, downSince: null, expectedMs: null, queuedAt: 0 });
      note(job, `Freed the graphics card and started again (try ${job.attempts} of ${MAX_ATTEMPTS}).`);
    } finally {
      job.fixing = false;
      fixing--;
      void dispatch();
    }
  }
  async function finishFixed(job, reason) {
    job.status = 'running'; // so finish() records it
    await finish(job, `${WHY[reason]}, even after trying again. ${ADVICE[reason]}`);
  }

  /** The watchdog (every few seconds): progress, finished jobs, and anything that went wrong. */
  async function poll() {
    if (active().length) connectWs();
    const job = inFlight();
    if (job && !job.fixing) {
      const up = await comfyUp();
      if (!up) {
        job.downSince ??= now();
        if (now() - job.downSince > DOWN_MS) await troubleshoot(job, 'down');
      } else {
        job.downSince = null;
        const hist = await comfyJson(`/history/${encodeURIComponent(job.promptId)}`).catch(() => null);
        const h = hist?.[job.promptId];
        const st = h?.status || {};
        if (h && (st.completed || st.status_str === 'success')) await finish(job);
        else if (h && st.status_str === 'error') {
          const msg = (st.messages || []).find((m) => m[0] === 'execution_error')?.[1]?.exception_message;
          await failed(job, msg || 'The job failed.');
        } else if (!h) {
          // Not finished: is ComfyUI still working on it? (Twice in a row, to be sure.)
          const q = await comfyJson('/queue', { timeout: 5000 }).catch(() => null);
          const there = !q || [...(q.queue_running || []), ...(q.queue_pending || [])].some((e) => e?.[1] === job.promptId);
          job.lostChecks = there ? 0 : (job.lostChecks || 0) + 1;
          if (job.lostChecks >= 2) await troubleshoot(job, 'lost');
          else if (job.startedAt && now() - job.startedAt > budgetFor(job.expectedMs || expectedMs(job))) await troubleshoot(job, 'overtime');
          else if (wsOpen && job.lastEventAt && now() - job.lastEventAt > STALL_MS) await troubleshoot(job, 'stalled');
        }
      }
    }
    // Jobs that never reached ComfyUI because it was down.
    const first = waiting()[0];
    if (first && !inFlight() && first.downSince && now() - first.downSince > DOWN_MS) {
      first.status = 'running';
      await finish(first, `${WHY.down}. ${ADVICE.down}`);
    }
    await dispatch();
    // Forget finished jobs after an hour (the gallery keeps the results).
    for (const [id, j] of jobs) if (j.finishedAt && now() - Date.parse(j.finishedAt) > 3600_000) jobs.delete(id);
    await releaseGpu();
  }

  async function cancel(id) {
    const job = jobs.get(id);
    if (!job) return null;
    if (job.status === 'queued' || job.status === 'running') {
      const pid = job.promptId;
      if (pid) {
        byPrompt.delete(pid);
        await comfyJson('/queue', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ delete: [pid] }) }).catch(() => {});
        if (job.status === 'running') await comfyJson('/interrupt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt_id: pid }) }).catch(() => {});
      }
      await finish(job, 'Stopped.');
    }
    return publicJob(job);
  }

  // ---- gallery
  async function readItem(id) {
    if (!/^[A-Za-z0-9_-]{6,40}$/.test(id)) return null;
    try {
      return JSON.parse(await fsp.readFile(path.join(metaDir, `${id}.json`), 'utf8'));
    } catch {
      return null;
    }
  }

  async function items(limit = 200) {
    const names = await fsp.readdir(metaDir).catch(() => []);
    const list = [];
    for (const n of names) {
      if (!n.endsWith('.json')) continue;
      const it = await readItem(n.slice(0, -5));
      if (it) list.push(it);
    }
    list.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return list.slice(0, limit);
  }

  async function remove(id) {
    const it = await readItem(id);
    if (!it) return false;
    await fsp.rm(path.join(dir, 'output', it.file), { force: true });
    await fsp.rm(path.join(metaDir, `${id}.json`), { force: true });
    return true;
  }

  /** Where an item's file is on disk (null when it is gone). */
  async function itemPath(id) {
    const it = await readItem(id);
    if (!it) return null;
    const outRoot = path.join(dir, 'output');
    const p = path.resolve(outRoot, it.file);
    if (!p.startsWith(outRoot + path.sep)) return null;
    return (await fsp.stat(p).catch(() => null)) ? p : null;
  }

  /** Put a finished file (already under output/) in the gallery, e.g. a stitched movie. */
  async function addItem({ kind, prompt, file, seconds, width, height, movie, photo }) {
    const item = { id: newId(), kind, maker: 'soreal', prompt, width, height, seconds, movie, photo: photo || undefined, file, createdAt: new Date(now()).toISOString() };
    await fsp.mkdir(metaDir, { recursive: true });
    await fsp.writeFile(path.join(metaDir, `${item.id}.json`), JSON.stringify(item));
    return item;
  }

  /** Open an item's file for sending. Returns { path, size, type, name } or null. */
  async function file(id) {
    const it = await readItem(id);
    if (!it) return null;
    const outRoot = path.join(dir, 'output');
    const p = path.resolve(outRoot, it.file);
    if (!p.startsWith(outRoot + path.sep)) return null;
    const st = await fsp.stat(p).catch(() => null);
    if (!st) return null;
    const ext = path.extname(p).toLowerCase();
    return { path: p, size: st.size, type: MIME[ext] || 'application/octet-stream', name: `${it.kind}-${id}${ext}` };
  }

  async function state() {
    const [setup, up, imageReady, videoReady] = await Promise.all([setupState(), comfyUp(), ready('image'), ready('video')]);
    return {
      setup,
      running: up,
      image: { ready: imageReady && up, downloaded: imageReady, percent: imageReady ? 100 : kindProgress('image') },
      video: { ready: videoReady && up, downloaded: videoReady, percent: videoReady ? 100 : kindProgress('video') },
      downloading: download.current ? { name: download.current.name, percent: download.current.total ? Math.floor((download.current.completed / download.current.total) * 100) : 0 } : null,
      downloadError: download.error,
      jobs: active().map(publicJob),
    };
  }

  return {
    start() {
      if (!helper) void downloadAll();
      const t = setInterval(() => void poll().catch(() => {}), o.pollMs ?? 3000);
      t.unref?.();
    },
    // A job counts for an hour at most: one that never finishes (the maker crashed under it) must not
    // keep the machine on all night.
    busy: () => download.running || active().some((j) => now() - (j.startedAt || Date.parse(j.createdAt)) < STUCK_JOB_MS),
    /** A chat needs the GPU: hand it back from ComfyUI now if nothing is being made. */
    async yieldGpu() {
      if (!comfyHoldsGpu || active().length) return;
      comfyHoldsGpu = false;
      await comfyJson('/free', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ unload_models: true, free_memory: true }) }).catch(
        () => {},
      );
    },
    state,
    makers,
    installMaker,
    removeMaker,
    createJob,
    job: (id) => (jobs.has(id) ? publicJob(jobs.get(id)) : null),
    cancel,
    items,
    item: readItem,
    itemPath,
    addItem,
    remove,
    file,
    poll,
    sizes: SIZES,
  };
}
