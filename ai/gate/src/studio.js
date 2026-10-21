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
import { UPLOAD_MAX, audioArgs, clipArgs, fitSize, ltxFrames, probeMedia, shapeOf, uploadType, vaceFrames } from './media.js';
import { createMirror, downloadFile, uploadFile } from './r2.js';
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
  LTX25_FPS,
  ltx25Frames,
  ltx25Workflow,
  qwenWorkflow,
  S2V_CHUNK,
  S2V_FPS,
  s2vChunks,
  s2vWorkflow,
  seedvr2Workflow,
  upscaleWorkflow,
  VACE_EXTEND_KEEP,
  VACE_FPS,
  VACE_MAX_FRAMES,
  vaceWorkflow,
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
  // Not measured yet (no GPU here when they were added): estimates from the models' sizes and step
  // counts, per second of 720p video. The machine learns the real ones after the first runs.
  'ltx-25': 45_000,
  s2v: 60_000,
  vace: 75_000,
  'video-erase': 75_000,
  'video-sharpen': 20_000,
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
/** True when a prompt mentions a child or a teenager at all (used where only adults may appear). */
export function mentionsMinor(text) {
  const t = String(text || '').toLowerCase().replace(/[_*~`]/g, ' ');
  return ALWAYS.test(t) || MINOR.some((re) => re.test(t)) || /\b(teen|teens|teenage\w*|adolescent\w*|high\s*school\w*|barely\s+legal|1[89]\s*(yo|y\/o|years?(\s*-?\s*old)?)|young[-\s]?looking|child[-\s]?like|baby[-\s]?face\w*)\b/.test(t) ||
    /\b(look|looks|looking|appear|appears|appearing|seem|seems|passes?\s+for)\s+(like\s+)?(about\s+|around\s+)?(underage|younger|very\s+young|a\s+teen\w*|([1-9]|1[0-9]))\b/.test(t);
}
export const BLOCKED_MESSAGE = "This can't be made: sexual content involving minors is never allowed.";

/** Photos you upload are often of real people: they can't be made sexual or undressed. */
const UNDRESS = /\b(undress\w*|unclothe\w*|remove\s+(her|his|their|the)?\s*(clothes|clothing|shirt|top|dress|bra|pants|underwear)|(?:take|takes|taking|took)\s+off\s+(her|his|their)?\s*(clothes|clothing)|without\s+clothes|no\s+clothes|wearing\s+nothing|bare\s+(skin|body|chest|breasts?)|see[-\s]?through|x-?ray)\b/;
export function blockedForPhoto(text) {
  const t = String(text || '').toLowerCase().replace(/[_*~`]/g, ' ');
  return SEXUAL.test(t) || UNDRESS.test(t);
}
/**
 * Erasing or replacing something in a real photo or video: naming clothes (or what is under them) as
 * the thing to take away would undress the people in it.
 */
const CLOTHES = /\b(clothes|clothing|outfit|shirts?|t-?shirts?|tops?|blouses?|dress(es)?|skirts?|bras?|pants|trousers|jeans|shorts|underwear|panties|bikinis?|swimsuits?|lingerie|thongs?|tights|stockings|leggings|jackets?|coats?|hoodies?|sweaters?|towels?|robes?|covering|garments?)\b/;
const WORN = /\b(she|he|they|her|him|them|the\s+(wo)?man|the\s+person)\s+(is\s+|are\s+|has\s+|have\s+)?(wearing|wears|wore|has\s+on|is\s+dressed\s+in)\b|\bwhat\s+(she|he|they)\b|\b(her|his|their)\s+(body|skin|chest|top\s+half|bottom\s+half)\b/;
export function blockedTarget(target) {
  const t = String(target || '').toLowerCase().replace(/[_*~`]/g, ' ').trim();
  if (blockedForPhoto(t) || WORN.test(t)) return true;
  // "the man in the red shirt" names the man (fine); "her shirt" names the shirt.
  const head = t.replace(/\b(in|with|wearing|who|that|holding|carrying|next\s+to|behind|on)\b.*$/, '');
  return CLOTHES.test(head);
}
/** Replacing clothes in a real photo or video is fine only with other clothes. */
const GARMENT = /\b(clothes|clothing|outfit|shirt|t-?shirt|top|blouse|dress|gown|skirt|suit|uniform|costume|jacket|coat|hoodie|sweater|jumper|jeans|pants|trousers|shorts|armou?r|robe|kimono|sari|overalls|apron|scarf|cardigan|vest|tuxedo|jersey)s?\b/;
export function blockedReplace(target, prompt) {
  if (blockedForPhoto(target) || blockedForPhoto(prompt)) return true;
  return blockedTarget(target) && !GARMENT.test(String(prompt || '').toLowerCase());
}
export const PHOTO_MESSAGE = "Photos you upload can't be made sexual or have clothes removed: they may show real people. Pictures made here from a description can.";

/** LTX-2.5's files are gated on Hugging Face: the machine needs a token that accepted the licence. */
export const TOKEN_MESSAGE =
  'LTX-2.5 needs a Hugging Face token: accept its licence at huggingface.co/Lightricks/LTX-2.5, add the token in Runpod as the secret hf_token, set AI_HF_TOKEN_SECRET=hf_token in Vercel, then turn the AI machine off and on.';
const TOKEN_REFUSED = 'Hugging Face refused the token: accept the licence at huggingface.co/Lightricks/LTX-2.5 with the account the token belongs to.';

// ---------------------------------------------------------------- helpers

const SIZES = {
  image: { square: [1328, 1328], portrait: [1104, 1472], landscape: [1472, 1104], wide: [1664, 928], tall: [928, 1664] },
  // LTX works in multiples of 64 here (half size, then 2x): 720 would come out as 704 anyway.
  video: { landscape: [1280, 704], portrait: [704, 1280], square: [960, 960] },
  // Krea 2 and H3 like their own sizes (H3: multiples of 32).
  krea: { square: [1024, 1024], portrait: [1024, 1536], landscape: [1536, 1024], wide: [1536, 864], tall: [864, 1536] },
  h3: { landscape: [1280, 704], portrait: [704, 1280], square: [960, 960] },
  // LTX-2.5 (multiples of 64: half size, then 2x) and Wan 2.2 S2V (its template: 640 x 640).
  ltx25: { landscape: [1280, 704], portrait: [704, 1280], square: [960, 960] },
  s2v: { square: [640, 640], portrait: [480, 832], landscape: [832, 480] },
};
/** The longest videos and sounds the video makers take (seconds). */
const MAX_SECONDS = { vace: VACE_MAX_FRAMES / VACE_FPS, extend: 10, ltx25: 10, seedvr2: 10, s2v: (4 * S2V_CHUNK) / S2V_FPS };
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
 *   r2         Cloudflare R2 client (createR2) when the machine has no network volume: model files,
 *              the gallery and settings are kept there and come back down after a restart
 *   hfToken    a Hugging Face token (HF_TOKEN), for gated model files (LTX-2.5); never logged or shown
 *   fetchImpl, WebSocketImpl, log, now, ffmpeg, probe     (tests)
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
  // deletes model files (the main machine does that). With R2 each machine has its own disk, so a
  // helper downloads what it needs too (from R2).
  const helper = Boolean(o.helper);
  const r2 = o.r2 || null;
  const mirror = r2 ? createMirror({ r2, root: path.join(dir, 'output'), prefix: 'gallery/', log }) : null;
  const modelKey = (file) => `models/${file.dir}/${file.name}`;
  const ffmpeg = o.ffmpeg || runFfmpeg;
  const probe = o.probe || probeMedia;
  const hfToken = String(o.hfToken || '').trim() || null;

  const jobs = new Map(); // id -> job
  const byPrompt = new Map(); // ComfyUI prompt_id -> job
  const download = { current: null, done: new Set(), error: null, running: false };
  // Files that can't come down until something changes (a gated file without a token): skipped, so
  // the other makers' files keep downloading.
  const blocked = new Map(); // name -> why
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
    // Kept in R2 already: bring it down in parallel pieces (much faster than the model's home site).
    const kept = r2 ? await r2.head(modelKey(file)).catch(() => null) : null;
    if (kept && (!file.size || kept.size === file.size)) {
      download.current = { name: file.name, completed: 0, total: kept.size };
      await downloadFile(r2, modelKey(file), part, { onBytes: (n) => (download.current.completed += n) });
      await fsp.rename(part, dest);
      return;
    }
    const have = (await fsp.stat(part).catch(() => null))?.size || 0;
    const url = `https://huggingface.co/${file.repo}/resolve/main/${file.path.split('/').map(encodeURIComponent).join('/')}`;
    if (file.gated && !hfToken) throw Object.assign(new Error(TOKEN_MESSAGE), { permanent: true });
    const headers = { ...(have ? { range: `bytes=${have}-` } : {}), ...(file.gated ? { authorization: `Bearer ${hfToken}` } : {}) };
    const res = await f(url, { headers, redirect: 'follow' });
    if (file.gated && (res.status === 401 || res.status === 403)) throw Object.assign(new Error(TOKEN_REFUSED), { permanent: true });
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
    // Keep a copy in R2 so the next start doesn't download it from its home site again.
    if (r2) {
      download.current = { name: file.name, completed: 0, total: size, saving: true };
      await uploadFile(r2, dest, modelKey(file), { onBytes: (n) => (download.current.completed += n) }).catch((err) =>
        log.warn?.(`[studio] could not keep ${file.name} in R2: ${err.message}`),
      );
    }
  }

  async function downloadAll() {
    if (download.running) return;
    download.running = true;
    try {
      // The list is read again after every file, so makers installed meanwhile are picked up.
      for (;;) {
        let next = null;
        for (const file of neededFiles()) {
          if (download.done.has(file.name) || blocked.has(file.name)) continue;
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
          if (err.permanent) {
            blocked.set(next.name, err.message);
            log.warn?.(`[studio] ${next.name}: ${err.message}`);
            continue;
          }
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
        // What it needs (and can also take): video, audio, photo, endPhoto, target (words); tasks it does.
        needs: m.needs || [],
        accepts: m.accepts || [],
        tasks: m.tasks || [],
        // Gated on Hugging Face (LTX-2.5): needs a token on the machine before it can download.
        gated: list.some((file) => file.gated),
        needsToken: !installed && list.some((file) => file.gated) && !hfToken,
        problem: list.map((file) => blocked.get(file.name)).find(Boolean) || null,
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
    if (r2) await r2.putJson('state/makers.json', { wanted: [...wanted] }).catch((err) => log.warn?.(`[studio] could not save makers in R2: ${err.message}`));
  }

  async function installMaker(id) {
    if (helper) throw Object.assign(new Error('Add makers from your main AI machine.'), { status: 409 });
    const m = makerById(id);
    if (!m) throw Object.assign(new Error('No such maker.'), { status: 404 });
    if (!hfToken && makerFiles(m).some((file) => file.gated) && !(await makerReady(m))) throw Object.assign(new Error(TOKEN_MESSAGE), { status: 400, needsToken: true });
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
      if (r2) await r2.remove(modelKey(file)).catch(() => {});
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
  const STAGES = {
    image: { 7: [0, 95] },
    video: { 38: [5, 70], 47: [70, 92], 50: [92, 99] },
    h3: { 10: [5, 90], 11: [90, 99] },
    upscale: { 3: [0, 95] },
    // LTX-2.5 first/last frame and video to video: one pass.
    onePass: { 38: [5, 90], 50: [90, 99] },
    vace: { 32: [2, 8], 21: [8, 92], 23: [92, 99] },
    seedvr2: { 10: [5, 85], 12: [85, 99] },
  };
  /** Wan S2V: each chunk's sampler covers its share of the bar. */
  function s2vStages(chunks) {
    const out = {};
    const ids = ['13', ...Array.from({ length: chunks - 1 }, (_, i) => String(21 + (i + 1) * 3))];
    ids.forEach((id, i) => (out[id] = [Math.round(3 + (92 * i) / chunks), Math.round(3 + (92 * (i + 1)) / chunks)]));
    out[92] = [95, 99];
    return out;
  }
  function onProgress(job, node, value, max) {
    const stage = (typeof job.stages === 'object' && job.stages ? job.stages : STAGES[job.stages || job.kind])?.[node];
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
  // Your jobs before the meme lab's (memes.js), which only fill time nobody is using.
  const waiting = () =>
    [...jobs.values()]
      .filter((j) => j.status === 'queued' && !j.promptId)
      .sort((a, b) => Number(Boolean(a.background)) - Number(Boolean(b.background)) || a.queuedAt - b.queuedAt || a.seq - b.seq);
  /** A job someone asked for is waiting or being made (not just the meme lab's). */
  const hasUserWork = () => active().some((j) => !j.background);
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
    if (r2) await r2.putJson(`state/${path.basename(timingsPath)}`, timings).catch(() => {});
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
    const src = await localFile(it);
    if (!src) throw Object.assign(new Error('Not found'), { status: 404 });
    const name = `orbit-${newId()}${path.extname(src).toLowerCase() || '.png'}`;
    await fsp.mkdir(path.join(dir, 'input'), { recursive: true });
    await fsp.copyFile(src, path.join(dir, 'input', name));
    return name;
  }

  /** The last frame of a gallery video, as a picture to start from (soReal: the next shot). */
  async function lastFrameOf(id) {
    const it = await readItem(id);
    if (!it || it.kind !== 'video') throw Object.assign(new Error('That video is no longer in your gallery.'), { status: 404 });
    const src = await localFile(it);
    if (!src) throw Object.assign(new Error('Not found'), { status: 404 });
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

  // ---- videos and sounds you bring (video makers)
  const uploadsDir = path.join(dir, 'uploads');
  const bad = (message, status = 400) => Object.assign(new Error(message), { status });

  /** Uploads are kept a day (so a second try needs no new upload), then cleared. */
  async function pruneUploads() {
    for (const n of await fsp.readdir(uploadsDir).catch(() => [])) {
      const p = path.join(uploadsDir, n);
      const st = await fsp.stat(p).catch(() => null);
      if (st && now() - st.mtimeMs > 24 * 3600_000) await fsp.rm(p, { force: true });
    }
  }

  /**
   * Keep a video or sound file sent as the request body (POST /_orbit/studio/uploads), streamed to
   * disk with a size limit. Returns { id, kind, size }; jobs refer to it by id.
   */
  async function saveMedia(stream, contentType, length) {
    const [kind, ext] = uploadType(contentType);
    const max = UPLOAD_MAX[kind];
    const tooBig = () => bad(`That ${kind === 'video' ? 'video' : 'sound file'} is too large (${Math.round(max / 1024 / 1024)} MB at most).`, 413);
    if (Number(length) > max) throw tooBig();
    await fsp.mkdir(uploadsDir, { recursive: true });
    await pruneUploads();
    const id = `u${newId()}`;
    const dest = path.join(uploadsDir, id + ext);
    let size = 0;
    const limit = new TransformStream({
      transform(chunk, ctrl) {
        size += chunk.byteLength;
        if (size > max) ctrl.error(tooBig());
        else ctrl.enqueue(chunk);
      },
    });
    try {
      const web = typeof stream?.getReader === 'function' ? stream : Readable.toWeb(stream);
      await pipeline(Readable.fromWeb(web.pipeThrough(limit)), fs.createWriteStream(dest));
    } catch (err) {
      await fsp.rm(dest, { force: true });
      throw size > max ? tooBig() : err.status ? err : bad('The upload did not finish. Try again.');
    }
    if (!size) {
      await fsp.rm(dest, { force: true });
      throw bad('That file is empty.');
    }
    return { id, kind, size };
  }

  async function uploadPath(id) {
    if (!/^u[A-Za-z0-9_-]{6,40}$/.test(String(id || ''))) return null;
    const n = (await fsp.readdir(uploadsDir).catch(() => [])).find((x) => x.startsWith(`${id}.`));
    return n ? path.join(uploadsDir, n) : null;
  }

  /**
   * A clean copy of a video for a maker (in ComfyUI's input folder), from what ffprobe says it is:
   *   vace     16 fps, up to 81 frames (4k + 1), fitted in 1280 × 720 (multiples of 16)
   *   extend   16 fps, up to 10 s (the recipe adds 64 frames)
   *   ltx25    24 fps, 8k + 1 frames up to 10 s, cropped to LTX-2.5's size for its shape
   *   seedvr2  its own frame rate, up to 10 s, at most 1280 × 720 (the recipe doubles it)
   */
  async function prepClip(src, plan) {
    const info = await probe(src);
    if (!info?.video || !(info.width > 0 && info.height > 0)) throw bad('That file is not a video the machine can read. Try an MP4 or MOV.');
    const dur = info.seconds || 0;
    let width;
    let height;
    let fps = null;
    let frames = null;
    let seconds;
    let fit = 'stretch';
    if (plan === 'vace' || plan === 'extend') {
      fps = VACE_FPS;
      [width, height] = fitSize(info.width, info.height, { long: 1280, short: 720, multiple: 16 });
      frames = plan === 'vace' ? vaceFrames(dur, VACE_MAX_FRAMES) : Math.min(Math.floor(dur * VACE_FPS), MAX_SECONDS.extend * VACE_FPS);
      if (frames < (plan === 'vace' ? 5 : VACE_EXTEND_KEEP)) throw bad(`That video is too short (it needs at least ${plan === 'vace' ? 'half a second' : 'one second'}).`);
      seconds = frames / VACE_FPS;
    } else if (plan === 'ltx25') {
      fps = LTX25_FPS;
      fit = 'cover';
      [width, height] = SIZES.ltx25[shapeOf(info.width, info.height)];
      frames = ltxFrames(dur, ltx25Frames(MAX_SECONDS.ltx25));
      if (frames < 9) throw bad('That video is too short (it needs at least half a second).');
      seconds = frames / LTX25_FPS;
    } else {
      [width, height] = fitSize(info.width, info.height, { long: 1280, short: 720, multiple: 16, enlarge: false });
      seconds = Math.min(dur || MAX_SECONDS.seedvr2, MAX_SECONDS.seedvr2);
    }
    const name = `orbit-${newId()}.mp4`;
    await fsp.mkdir(path.join(dir, 'input'), { recursive: true });
    await ffmpeg(clipArgs(src, path.join(dir, 'input', name), { width, height, fps, frames, seconds, hasAudio: info.audio, fit }), { timeoutMs: 5 * 60_000 });
    return { name, width, height, frames, seconds, fps: fps || info.fps || 0, sourceSeconds: dur };
  }

  /** A voice or song as a WAV for Wan S2V, at most about 19 s (four chunks). */
  async function prepAudio(src) {
    const info = await probe(src);
    if (!info?.audio) throw bad('That file has no sound the machine can read. Try an MP3, M4A or WAV.');
    const seconds = Math.min(info.seconds || MAX_SECONDS.s2v, MAX_SECONDS.s2v);
    if (seconds < 0.5) throw bad('That sound is too short (it needs at least half a second).');
    const name = `orbit-${newId()}.wav`;
    await fsp.mkdir(path.join(dir, 'input'), { recursive: true });
    await ffmpeg(audioArgs(src, path.join(dir, 'input', name), { seconds }), { timeoutMs: 2 * 60_000 });
    return { name, seconds };
  }

  /**
   * Start a job. req: { kind: 'image'|'video', maker?, prompt, size?, seconds?, style?,
   *   image? (data URL), images? (data URLs, for edits), fromItem? (gallery id),
   *   endImage? (data URL: the picture a video ends on), toItem? (gallery picture to end on),
   *   videoItem? (gallery video to work on) or videoUpload? (upload id), audioUpload? (upload id),
   *   task? (Wan VACE: replace | restyle | extend | motion), target? (words: what to replace or erase),
   *   change? (LTX-2.5 video to video: 'little' | 'lot') }.
   * Throws errors with .status for bad requests.
   */
  async function createJob(req) {
    const maker = req.maker ? makerById(String(req.maker)) : makerById(req.kind === 'video' ? 'ltx' : 'qwen');
    if (!maker || maker.kind === 'style') throw Object.assign(new Error('No such maker.'), { status: 400 });
    const mode = maker.kind; // image | video | edit | upscale | videoedit
    // Which recipe: krea (Krea 2 family), qwen (Qwen Image family), ltx, ltx25, h3 or s2v (video),
    // vace or seedvr2 (video edits).
    const flow = maker.workflow || (maker.id === 'krea-real' ? 'krea' : maker.id === 'h3-max' ? 'h3' : mode === 'video' ? 'ltx' : 'qwen');
    const kind = mode === 'video' || mode === 'videoedit' ? 'video' : 'image';
    // Wan VACE: what to do with the video (Erase from video always erases).
    const task = flow === 'vace' ? maker.task || (maker.tasks?.includes(String(req.task)) ? String(req.task) : maker.tasks?.[0] || 'replace') : null;
    const needs = new Set(maker.needs || []);
    if (task === 'replace' || task === 'erase') needs.add('target');
    if (task === 'motion') needs.add('photo');
    let prompt = String(req.prompt || '').trim().slice(0, 4000);
    const target = String(req.target || '').trim().slice(0, 200);
    // Sharpening and erasing need no description; a talking photo has a default one.
    const promptOptional = mode === 'upscale' || flow === 'seedvr2' || task === 'erase' || flow === 's2v';
    if (!prompt && !promptOptional) throw bad(mode === 'edit' || mode === 'videoedit' ? 'Describe the change.' : 'Describe what to make.');
    if (needs.has('target') && !target) throw bad(task === 'erase' ? 'Say what to erase, e.g. “the man in the red shirt”.' : 'Say what to replace, e.g. “the red car”.');
    if (blockedPrompt(prompt) || blockedPrompt(target) || blockedPrompt(`${prompt} ${target}`)) throw Object.assign(new Error(BLOCKED_MESSAGE), { status: 422, blocked: true });
    const uploads = [...(req.image ? [req.image] : []), ...(Array.isArray(req.images) ? req.images : [])].slice(0, 2);
    const endUpload = req.endImage && kind === 'video' ? String(req.endImage) : null;
    // A gallery picture or video that came from someone's photo keeps the photo rule.
    const fromId = req.fromLastFrameOf || req.fromItem;
    const source = fromId ? await readItem(String(fromId)) : null;
    // soReal: a gallery picture a video should end on (first and last frame).
    const toSource = req.toItem && mode === 'video' ? await readItem(String(req.toItem)) : null;
    // A video to work on: from the gallery, or one you uploaded.
    const videoSource = req.videoItem ? await readItem(String(req.videoItem)) : null;
    if (req.videoItem && videoSource?.kind !== 'video') throw bad('That video is no longer in your gallery.', 404);
    const videoUpload = req.videoUpload ? String(req.videoUpload) : null;
    const audioUpload = req.audioUpload ? String(req.audioUpload) : null;
    const withVideo = Boolean(videoSource || videoUpload) && (mode === 'videoedit' || (maker.accepts || []).includes('video'));
    // Any photo or video you bring may show real people (a recording of a voice doesn't change that).
    const photo = uploads.length > 0 || Boolean(endUpload) || Boolean(source?.photo) || Boolean(toSource?.photo) || (withVideo && (Boolean(videoUpload) || Boolean(videoSource?.photo)));
    // Made from an NSFW picture or video: NSFW too, before anyone has looked.
    const nsfwSource = Boolean(source?.nsfw) || Boolean(toSource?.nsfw) || (withVideo && Boolean(videoSource?.nsfw));
    if (photo) {
      const refused =
        blockedForPhoto(prompt) || (task === 'erase' ? blockedTarget(target) : task === 'replace' ? blockedReplace(target, prompt) : target ? blockedForPhoto(target) : false);
      if (refused) throw Object.assign(new Error(PHOTO_MESSAGE), { status: 422, blocked: true });
    }
    if (needs.has('video') && !withVideo) throw bad('Add the video to work on.');
    if (needs.has('audio') && !audioUpload) throw bad('Add a voice recording or a song.');
    if (needs.has('photo') && !uploads.length && !req.fromItem) throw bad(task === 'motion' ? 'Add a photo of who should move.' : 'Add a photo of the person.');
    if (!(await makerReady(maker))) {
      const pct = (await makers()).find((m) => m.id === maker.id)?.percent ?? 0;
      const what = maker.builtIn ? `The ${maker.name} maker is still downloading (${pct}%)` : `${maker.name} is ${wanted.has(maker.id) ? `still downloading (${pct}%)` : 'not installed'}`;
      throw Object.assign(new Error(`${what}. Try again when it's done.`), { status: 503 });
    }
    let style = null;
    let styleTrigger = null;
    if (req.style) {
      const s = makerById(String(req.style));
      if (!s || s.kind !== 'style' || s.for !== maker.id) throw Object.assign(new Error('That style is not for this maker.'), { status: 400 });
      if (!(await makerReady(s))) throw Object.assign(new Error(`The ${s.name} style is not installed yet.`), { status: 503 });
      style = s.loraFile.name;
      styleTrigger = s.trigger || null;
    }
    if (!(await comfyUp())) throw Object.assign(new Error('The image and video maker is still starting. Try again in a minute.'), { status: 503 });

    const id = newId();
    const prefix = `orbit/${kind}-${id}`;
    // The video and the sound to work on, prepared for the maker.
    let clip = null;
    if (withVideo) {
      const src = videoSource ? await localFile(videoSource) : await uploadPath(videoUpload);
      if (!src) throw bad(videoSource ? 'That video is no longer in your gallery.' : 'That upload has expired. Add the video again.', 404);
      clip = await prepClip(src, flow === 'ltx25' ? 'ltx25' : flow === 'seedvr2' ? 'seedvr2' : task === 'extend' ? 'extend' : 'vace');
    }
    let sound = null;
    if (needs.has('audio')) {
      const src = await uploadPath(audioUpload);
      if (!src) throw bad('That upload has expired. Add the sound again.', 404);
      sound = await prepAudio(src);
    }
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
      const endImage = toSource ? await copyFromGallery(toSource.id) : endUpload ? await saveUpload(endUpload) : null;
      if (flow === 'h3') {
        // H3 is trained on clips of about 5 to 15 s; shorter ones come out poorly.
        seconds = Math.max(5, seconds);
        [width, height] = SIZES.h3[req.size] || SIZES.h3.landscape;
        workflow = h3Workflow({ prompt, width, height, seconds, image, endImage, prefix, ...(maker.id !== 'h3-max' ? { unet: FILES[maker.files[0]].name } : {}), turbo: maker.turbo ? FILES[maker.turbo].name : null });
        stages = 'h3';
      } else if (flow === 'ltx25') {
        if (clip) {
          // Video to video: the clip's own shape, length and sound.
          ({ width, height } = clip);
          seconds = Math.round(clip.seconds * 10) / 10;
          workflow = ltx25Workflow({ prompt, video: clip.name, width, height, frames: clip.frames, strength: req.change === 'little' ? 0.75 : 0.95, prefix });
          stages = 'onePass';
        } else {
          [width, height] = SIZES.ltx25[req.size] || SIZES.ltx25.landscape;
          workflow = ltx25Workflow({ prompt, width, height, seconds, image, endImage, prefix });
          stages = endImage ? 'onePass' : 'video';
        }
      } else if (flow === 's2v') {
        [width, height] = SIZES.s2v[req.size] || SIZES.s2v.square;
        const chunks = s2vChunks(sound.seconds);
        seconds = Math.round(Math.min(sound.seconds, (chunks * S2V_CHUNK) / S2V_FPS));
        prompt = prompt || 'The person in the photo talks or sings to the camera with natural expressions and gestures.';
        workflow = s2vWorkflow({ prompt, image, audio: sound.name, width, height, chunks, prefix });
        stages = s2vStages(chunks);
      } else {
        [width, height] = SIZES.video[req.size] || SIZES.video.landscape;
        workflow = videoWorkflow({ prompt, width, height, seconds, image, endImage, prefix, ...(maker.builtIn ? {} : { ckpt: FILES[maker.files[0]].name }), lora: !maker.noLora });
      }
    } else if (mode === 'videoedit') {
      // What the gallery shows: your words, else the video's own (so its NSFW blur carries over).
      const shown = prompt || (task === 'erase' ? `Erased: ${target}${videoSource?.prompt ? ` · ${videoSource.prompt}` : ''}` : videoSource?.prompt || 'Sharpened video');
      if (flow === 'seedvr2') {
        width = clip.width * 2;
        height = clip.height * 2;
        seconds = Math.round(clip.seconds * 10) / 10;
        workflow = seedvr2Workflow({ video: clip.name, multiplier: 2, prefix });
        stages = 'seedvr2';
      } else {
        ({ width, height } = clip);
        seconds = Math.round(((task === 'extend' ? clip.frames + VACE_MAX_FRAMES - VACE_EXTEND_KEEP : clip.frames) / VACE_FPS) * 10) / 10;
        const words = prompt || 'The same scene with that part gone: a clean, natural background where it was, everything else unchanged.';
        workflow = vaceWorkflow({ task, prompt: words, video: clip.name, width, height, frames: clip.frames, target, reference: inputs[0] || null, prefix });
        stages = 'vace';
      }
      prompt = shown;
    } else if (mode === 'edit') {
      const lora = maker.lora ? FILES[maker.lora].name : null;
      // Some edit LoRAs only wake up on their trigger words.
      if (maker.trigger && !prompt.startsWith(maker.trigger)) prompt = `${maker.trigger} ${prompt}`;
      workflow = editWorkflow({ prompt, images: inputs.slice(0, need), lora, strength: maker.strength ?? 1, prefix });
    } else if (mode === 'upscale') {
      prompt = prompt || 'Sharpened 4×';
      workflow = upscaleWorkflow({ image: inputs[0], prefix, model: FILES[maker.files[0]].name });
      stages = 'upscale';
    } else if (flow === 'krea') {
      [width, height] = SIZES.krea[req.size] || SIZES.krea.portrait;
      workflow = kreaWorkflow({ prompt, width, height, style, trigger: styleTrigger, unet: FILES[maker.files[0]].name, prefix });
    } else {
      [width, height] = SIZES.image[req.size] || SIZES.image.square;
      workflow =
        maker.id === 'qwen'
          ? imageWorkflow({ prompt, width, height, prefix })
          : qwenWorkflow({
              unet: FILES[maker.files[0]].name,
              prompt,
              width,
              height,
              // Turbo models: few steps, no guidance (cfg 1, so no negative prompt either).
              ...(maker.steps ? { steps: maker.steps, cfg: maker.cfg ?? 1 } : { cfg: 3, negative: NOCT_NEGATIVE }),
              prefix,
            });
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
      background: Boolean(req.background),
      photo,
      nsfwSource,
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
    // Your job doesn't wait behind a meme-lab video: that one stops and makes way.
    if (!job.background) {
      const lab = inFlight();
      if (lab?.background) {
        note(lab, 'Made way for your job.');
        await cancel(lab.id).catch(() => {});
      }
    }
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
      if (comfyHoldsGpu && (job.kind === 'video' || lastMode === 'video')) {
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
      lastMode = job.kind;
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
        nsfw: job.nsfwSource || undefined,
        // Made by the meme lab: kept out of the gallery until you keep it.
        lab: job.background || undefined,
        file,
        createdAt: job.createdAt,
      };
      await fsp.mkdir(metaDir, { recursive: true });
      await fsp.writeFile(path.join(metaDir, `${job.id}.json`), JSON.stringify(item));
      await keep(item);
      job.item = item;
      job.progress = 100;
      job.status = 'done';
      await learn(job);
      if (!item.nsfw) void rate(item);
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
        // Sent to ComfyUI means it may already be running there, before its first progress event.
        await comfyJson('/interrupt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt_id: pid }) }).catch(() => {});
      }
      await finish(job, 'Stopped.');
    }
    return publicJob(job);
  }

  // ---- gallery
  async function readItem(id) {
    if (!/^[A-Za-z0-9_-]{6,40}$/.test(id)) return null;
    const note = path.join(metaDir, `${id}.json`);
    for (let tries = 0; tries < 2; tries++) {
      try {
        return JSON.parse(await fsp.readFile(note, 'utf8'));
      } catch {
        // Made on the other machine or before this start: its note may only be in R2 so far.
        if (!mirror || tries || !(await mirror.fetch(note).catch(() => false))) return null;
      }
    }
    return null;
  }

  /** Copy an item (its file, then its note) to R2. */
  async function keep(item) {
    if (!mirror) return;
    const p = path.resolve(path.join(dir, 'output'), item.file);
    if (p.startsWith(path.join(dir, 'output') + path.sep)) await mirror.save(p);
    await mirror.save(path.join(metaDir, `${item.id}.json`));
  }

  // With R2 the gallery's notes come down from there (the other machine's creations too, and what
  // was made before this start); a note gone from R2 was deleted elsewhere.
  let synced = 0;
  let syncing = null;
  async function syncGallery() {
    if (!mirror || now() - synced < 20_000) return;
    syncing ||= (async () => {
      try {
        const there = new Set(await mirror.pull('orbit/', (rel) => /^orbit\/[A-Za-z0-9_-]+\.json$/.test(rel)));
        for (const n of await fsp.readdir(metaDir).catch(() => [])) {
          if (!n.endsWith('.json') || there.has(`orbit/${n}`)) continue;
          // Just made here and still on its way up: keep it.
          const st = await fsp.stat(path.join(metaDir, n)).catch(() => null);
          if (st && now() - st.mtimeMs > 5 * 60_000) await fsp.rm(path.join(metaDir, n), { force: true });
        }
        synced = now();
      } catch (err) {
        log.warn?.(`[studio] could not read the gallery from R2: ${err.message}`);
      } finally {
        syncing = null;
      }
    })();
    await syncing;
  }

  /** An item's file on this machine's disk, brought down from R2 when it is only there (null when gone). */
  async function localFile(it) {
    const outRoot = path.join(dir, 'output');
    const p = path.resolve(outRoot, it.file);
    if (!p.startsWith(outRoot + path.sep)) return null;
    if (await fsp.stat(p).catch(() => null)) return p;
    if (mirror && (await mirror.fetch(p).catch(() => false))) return p;
    return null;
  }

  async function items(limit = 200, lab = false) {
    await syncGallery();
    const names = await fsp.readdir(metaDir).catch(() => []);
    const list = [];
    for (const n of names) {
      if (!n.endsWith('.json')) continue;
      const it = await readItem(n.slice(0, -5));
      if (it && Boolean(it.lab) === lab) list.push(it);
    }
    list.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return list.slice(0, limit);
  }

  /** Move a meme-lab video into the gallery. */
  async function promote(id) {
    const it = await readItem(id);
    if (!it?.lab) return false;
    delete it.lab;
    await fsp.writeFile(path.join(metaDir, `${id}.json`), JSON.stringify(it));
    await keep(it);
    return true;
  }

  async function remove(id) {
    const it = await readItem(id);
    if (!it) return false;
    await fsp.rm(path.join(dir, 'output', it.file), { force: true });
    await fsp.rm(path.join(metaDir, `${id}.json`), { force: true });
    if (mirror) {
      await mirror.drop(path.join(metaDir, `${id}.json`));
      const p = path.resolve(path.join(dir, 'output'), it.file);
      if (p.startsWith(path.join(dir, 'output') + path.sep)) await mirror.drop(p);
    }
    return true;
  }

  /** Where an item's file is on disk (null when it is gone). */
  async function itemPath(id) {
    const it = await readItem(id);
    return it ? localFile(it) : null;
  }

  /** Put a finished file (already under output/) in the gallery, e.g. a stitched movie. */
  async function addItem({ kind, prompt, file, seconds, width, height, movie, photo, nsfw }) {
    const item = { id: newId(), kind, maker: 'soreal', prompt, width, height, seconds, movie, photo: photo || undefined, nsfw: nsfw || undefined, file, createdAt: new Date(now()).toISOString() };
    await fsp.mkdir(metaDir, { recursive: true });
    await fsp.writeFile(path.join(metaDir, `${item.id}.json`), JSON.stringify(item));
    await keep(item);
    if (!item.nsfw) void rate(item);
    return item;
  }

  // ---- the NSFW check: look at each picture or video once, and remember the answer in its note.
  const rating = new Set();
  /** Look at an item and save whether it is NSFW (nsfw: true | false). Quiet when the checker can't run. */
  async function rate(item) {
    if (!o.nsfw || rating.has(item.id)) return;
    rating.add(item.id);
    try {
      const p = await localFile(item);
      if (!p) return;
      const r = await o.nsfw.check(p, { kind: item.kind, seconds: item.seconds });
      if (!r) return;
      // Read the note again: it may have changed meanwhile (kept from the Lab, for one).
      const latest = (await readItem(item.id)) || item;
      latest.nsfw = r.nsfw || Boolean(latest.nsfw);
      latest.nsfwScore = r.score;
      item.nsfw = latest.nsfw;
      await fsp.writeFile(path.join(metaDir, `${item.id}.json`), JSON.stringify(latest));
      await keep(latest);
    } catch (err) {
      log.warn?.(`[nsfw] ${item.id}: ${err.message}`);
    } finally {
      rating.delete(item.id);
    }
  }

  /** Everything made before the check existed (or while it couldn't run): look at it now, one at a time. */
  async function rateAll() {
    if (!o.nsfw) return;
    for (const lab of [false, true]) {
      for (const it of await items(10_000, lab).catch(() => [])) {
        if (typeof it.nsfw === 'boolean') continue;
        await rate(it);
      }
    }
  }

  /** Open an item's file for sending. Returns { path, size, type, name } or null. */
  async function file(id) {
    const it = await readItem(id);
    if (!it) return null;
    const p = await localFile(it);
    if (!p) return null;
    const st = await fsp.stat(p).catch(() => null);
    if (!st) return null;
    const ext = path.extname(p).toLowerCase();
    return { path: p, size: st.size, type: MIME[ext] || 'application/octet-stream', name: `${it.kind}-${id}${ext}` };
  }

  /** Settings kept in R2 (which makers are added, learned timings), read at start. */
  async function loadSaved() {
    try {
      const saved = await r2.getJson('state/makers.json');
      if (saved?.wanted) {
        wanted = new Set(saved.wanted);
        await fsp.writeFile(wantedPath, JSON.stringify({ wanted: [...wanted] })).catch(() => {});
      }
      const t = await r2.getJson(`state/${path.basename(timingsPath)}`);
      if (t && typeof t === 'object') timings = { ...t, ...timings };
    } catch (err) {
      log.warn?.(`[studio] could not read saved settings from R2: ${err.message}`);
    }
  }

  async function state() {
    const [setup, up, imageReady, videoReady] = await Promise.all([setupState(), comfyUp(), ready('image'), ready('video')]);
    return {
      setup,
      running: up,
      image: { ready: imageReady && up, downloaded: imageReady, percent: imageReady ? 100 : kindProgress('image') },
      video: { ready: videoReady && up, downloaded: videoReady, percent: videoReady ? 100 : kindProgress('video') },
      downloading: download.current ? { name: download.current.name, saving: Boolean(download.current.saving), percent: download.current.total ? Math.floor((download.current.completed / download.current.total) * 100) : 0 } : null,
      downloadError: download.error,
      jobs: active().filter((j) => !j.background).map(publicJob),
    };
  }

  return {
    start() {
      void (async () => {
        if (r2) await loadSaved();
        if (!helper || r2) await downloadAll();
      })();
      // Look over the gallery for NSFW a little after start, then every half hour for anything missed.
      const look = () => void rateAll().catch((err) => log.warn?.(`[nsfw] ${err.message}`));
      setTimeout(look, o.nsfwDelayMs ?? 60_000).unref?.();
      setInterval(look, 30 * 60_000).unref?.();
      const t = setInterval(() => void poll().catch(() => {}), o.pollMs ?? 3000);
      t.unref?.();
    },
    // A job counts for an hour at most: one that never finishes (the maker crashed under it) must not
    // keep the machine on all night.
    // Meme-lab videos never count: they only fill time and must not keep the machine on.
    busy: () => download.running || active().some((j) => !j.background && now() - (j.startedAt || Date.parse(j.createdAt)) < STUCK_JOB_MS),
    hasUserWork,
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
    saveMedia,
    job: (id) => (jobs.has(id) ? publicJob(jobs.get(id)) : null),
    /** soReal: how long a job like this usually takes here (learned timings), in seconds. */
    estimate({ kind = 'image', maker, size, seconds, cold = false } = {}) {
      const m = makerById(String(maker || (kind === 'video' ? 'ltx' : 'qwen')));
      const k = m?.kind === 'video' || m?.kind === 'videoedit' ? 'video' : 'image';
      const table =
        k === 'video'
          ? m?.id === 'h3-max' || m?.workflow === 'h3'
            ? SIZES.h3
            : m?.workflow === 'ltx25'
              ? SIZES.ltx25
              : m?.workflow === 's2v'
                ? SIZES.s2v
                : SIZES.video
          : m?.id === 'krea-real'
            ? SIZES.krea
            : SIZES.image;
      const [width, height] = table[size] || Object.values(table)[0];
      return Math.round(expectedMs({ kind: k, maker: m?.id || maker, width: m?.kind === 'edit' ? undefined : width, height: m?.kind === 'edit' ? undefined : height, seconds }, cold) / 1000);
    },
    cancel,
    items,
    labItems: (limit = 200) => items(limit, true),
    promote,
    item: readItem,
    itemPath,
    addItem,
    remove,
    file,
    poll,
    /** Check every unchecked picture and video now (tests; also runs by itself after start). */
    rateAll,
    sizes: SIZES,
    mirror,
  };
}
