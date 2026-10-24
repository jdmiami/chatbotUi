// Image and video maker ("studio") for the AI machine: downloads the model files, runs jobs on the
// local ComfyUI (127.0.0.1:8188, never exposed), tracks their progress, keeps a gallery on the
// network volume and serves the results. Everything that creates something goes through
// createJob(), which applies the one content rule (no sexual content involving minors).
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { lastFrameArgs, runFfmpeg } from './movies.js';
import { UPLOAD_MAX, audioArgs, clipArgs, fitSize, ltxFrames, probeMedia, shapeOf, uploadType, vaceFrames } from './media.js';
import { createMirror, downloadFile, uploadFile } from './r2.js';
import { injectCharacter } from './characterPrompt.js';
import { createHeld } from './held.js';
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
  SWAP_FPS,
  SWAP_MAX_FRAMES,
  swapWorkflow,
  upscaleWorkflow,
  VACE_EXTEND_KEEP,
  VACE_FPS,
  VACE_MAX_FRAMES,
  vaceWorkflow,
  videoWorkflow,
  zimageSketchWorkflow,
  sketchStrength,
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
  // Swap a person: about as many tokens as a 5 s 720p video edit, at 832 × 480 (its input is doubled),
  // plus some time for the parts of the model that wait in RAM.
  'person-swap': 170_000,
  // Sketch finish (Z-Image-Turbo + Fun ControlNet, 8 steps at about 1 megapixel): not measured either.
  'sketch-finish': 20_000,
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
/**
 * Swap a person puts a real person's photo into a video: only adults, never into a video marked NSFW,
 * and a result the NSFW check flags (or that it could not look at) is thrown away, not just blurred.
 */
export const SWAP_MINOR_MESSAGE = "Swap a person only works with adults: it can't swap a child or a teenager, in the video or from a photo.";
export const SWAP_NSFW_MESSAGE = "A photo of a real person can't be put into a video marked NSFW.";
export const CHECK_MESSAGE = "The safety check couldn't look at the result, so it was set aside for a person to review. It is not in your gallery.";
/** Adult swaps: only a character made here, in a video made here (never a photo or an upload). */
export const ADULT_SWAP_MESSAGE = 'Adult swaps only work with a character you made here, on a video made here.';
export const CHARACTER_MESSAGE = 'Swap a person only works with an adult character made here from words.';
/** Who to replace must name a person, not what they wear (and the words can't be sexual). */
export function blockedSwap(target, prompt = '') {
  return blockedTarget(target) || blockedForPhoto(prompt);
}

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
  // Swap a person: the size its example workflow runs at (the clip's own shape, inside 832 × 480).
  swap: { landscape: [832, 480], portrait: [480, 832], square: [480, 480] },
  // Sketch finish (Z-Image-Turbo): about a megapixel, multiples of 16.
  sketch: { square: [1024, 1024], portrait: [832, 1216], landscape: [1216, 832] },
};
/** The longest videos and sounds the video makers take (seconds). */
const MAX_SECONDS = { vace: VACE_MAX_FRAMES / VACE_FPS, extend: 10, ltx25: 10, seedvr2: 10, s2v: (4 * S2V_CHUNK) / S2V_FPS, swap: SWAP_MAX_FRAMES / SWAP_FPS };
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.webm': 'video/webm' };
/** A model download that sends nothing for this long is cut and resumed. */
const STALL_DOWNLOAD_MS = 60_000;
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
 *   gallery    an R2 client for the gallery only (GALLERY=r2 on a volume: the drawing machine); r2 when unset
 *   role       main | helper | canvas (its own state file, timings and ComfyUI folder per role)
 *   makers     maker ids this machine keeps instead of the built-ins (the drawing machine's short list)
 *   characters saved characters (characters.js): get(id) -> { id, name, adult, fictional, sheet: [image files], descriptor }
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
  const role = o.role || (o.helper ? 'helper' : 'main');
  const helper = role === 'helper';
  // Files named per role, so machines sharing a folder never write each other's.
  const perRole = (name, ext = '') => (role === 'main' ? `${name}${ext}` : `${name}-${role}${ext}`);
  const r2 = o.r2 || null;
  // The gallery can be in R2 while everything else is on a volume (the drawing machine).
  const galleryR2 = o.gallery || r2;
  const mirror = galleryR2 ? createMirror({ r2: galleryR2, root: path.join(dir, 'output'), prefix: 'gallery/', log }) : null;
  // Results that must not go straight to the user wait here for the owner (held.js): `held/` in R2, else a
  // `held/` folder next to the gallery. Never listed in the gallery, never mirrored to its prefix.
  const heldStore = createHeld({ dir, r2: galleryR2, log, now });
  // Saved characters (characters.js): characters.get(id) -> { id, name, adult, fictional, sheet: [{ file }], descriptor, traits } (front first, face close-up second).
  const characters = o.characters || null;
  // A machine with its own short list keeps only those makers (and what is added), not the built-ins.
  const only = Array.isArray(o.makers) ? new Set(o.makers) : null;
  const modelKey = (file) => `models/${file.dir}/${file.name}`;
  const ffmpeg = o.ffmpeg || runFfmpeg;
  const probe = o.probe || probeMedia;
  const hfToken = String(o.hfToken || '').trim() || null;

  const jobs = new Map(); // id -> job
  const byPrompt = new Map(); // ComfyUI prompt_id -> job
  const download = { current: null, done: new Set(), error: null, running: false, paused: false, ctrl: null, log: [] };
  /** What happened, newest last (the download manager shows it; kept short). */
  function logDownload(kind, text) {
    download.log.push({ at: new Date().toISOString(), kind, text });
    if (download.log.length > 60) download.log.splice(0, download.log.length - 60);
    // In the machine's own log too, so a long first start can be followed from Runpod.
    log.info?.(`[download] ${text}`);
  }
  let lastProgressLog = 0;
  /** The file being fetched: where from, how far, and how fast (bytes a second over the last ~10 s). */
  function begin(file, source, completed, total, saving = false) {
    download.current = { id: fid(file), name: file.name, source, completed, total, saving, startedAt: Date.now(), samples: [[Date.now(), completed]] };
  }
  function tick(n) {
    const c = download.current;
    if (!c) return;
    c.completed += n;
    const t = Date.now();
    const last = c.samples[c.samples.length - 1];
    if (t - last[0] >= 500) c.samples.push([t, c.completed]);
    while (c.samples.length > 2 && t - c.samples[0][0] > 10_000) c.samples.shift();
    // Once a minute: how far the current file is (the log shows a long download is moving).
    if (t - lastProgressLog >= 60_000) {
      lastProgressLog = t;
      const pct = c.total ? Math.floor((c.completed / c.total) * 100) : null;
      const sp = speedOf(c);
      log.info?.(`[download] ${c.name}: ${pct != null ? `${pct}%` : `${(c.completed / GB).toFixed(1)} GB`} ${c.saving ? `onto ${c.source}` : `from ${c.source}`}${sp ? `, ${Math.round(sp / 1e6)} MB/s` : ''}`);
    }
  }
  function speedOf(c) {
    if (!c || c.samples.length < 2) return null;
    const [t0, b0] = c.samples[0];
    const t1 = Date.now();
    const dt = (t1 - t0) / 1000;
    return dt > 0 ? Math.max(0, (c.completed - b0) / dt) : null;
  }
  // Files that can't come down until something changes (a gated file without a token): skipped, so
  // the other makers' files keep downloading.
  const blocked = new Map(); // name -> why
  let lastJobEnd = 0;
  let comfyHoldsGpu = false;
  let lastMode = null; // what the last job made (video models are huge)
  let ws = null;

  const modelPath = (file) => path.join(dir, 'models', file.dir, file.name);
  // On a global volume (the drawing machine) model files are not written in place: its object storage
  // can't append or rename cheaply, so each file comes down onto the pod's own disk (o.stageDir) and
  // is then copied over in one pass. Free space is the pod disk's, and it only needs one file at a time.
  const stageDir = o.stageDir || null;
  const partPath = (file) => (stageDir ? path.join(stageDir, `${file.dir}/${file.name}`.replace(/[\\/]/g, '__')) + '.part' : `${modelPath(file)}.part`);
  async function place(part, dest, file) {
    if (!stageDir) return fsp.rename(part, dest);
    // A file whose size is known is told apart from a half-copied one by its size; one without is
    // copied under another name first.
    const to = file.size ? dest : `${dest}.copying`;
    const counter = new Transform({
      transform(chunk, _enc, cb) {
        tick(chunk.length);
        cb(null, chunk);
      },
    });
    await pipeline(fs.createReadStream(part), counter, fs.createWriteStream(to));
    if (to !== dest) await fsp.rename(to, dest);
    await fsp.rm(part, { force: true });
  }
  // Files are told apart by folder and name (Live draw has several config.json files).
  const fid = (file) => `${file.dir}/${file.name}`;
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
  // Live Draw and live video run only on the drawing machine (role 'canvas'): any other machine
  // never keeps, lists or downloads them, even if an older version of it was asked to.
  const drawingOnly = (m) => role !== 'canvas' && (m.kind === 'live' || m.kind === 'sketch');
  const keeps = (m) => !drawingOnly(m) && ((only ? only.has(m.id) : m.builtIn) || wanted.has(m.id));
  // A short list also sets the download order (what is needed first comes down first).
  const rank = (m) => (only?.has(m.id) ? [...only].indexOf(m.id) : Infinity);
  const kept = () => (only ? MAKERS.filter(keeps).sort((a, b) => rank(a) - rank(b)) : MAKERS.filter(keeps));
  /** Every file to keep on the machine, in download order: the built-in image and video makers first. */
  function neededFiles() {
    const seen = new Map();
    if (!only) for (const kind of ['image', 'video']) for (const file of files[kind]) seen.set(fid(file), file);
    for (const m of kept()) for (const file of makerFiles(m)) if (!seen.has(fid(file))) seen.set(fid(file), file);
    return [...seen.values()];
  }
  const metaDir = path.join(dir, 'output', 'orbit');

  // ---- model downloads (resumable, one at a time; images first)
  async function haveFile(file) {
    const st = await fsp.stat(modelPath(file)).catch(() => null);
    return Boolean(st && (!file.size || st.size === file.size));
  }

  const GB = 1024 ** 3;
  /** Free space where the models go (null when it can't be read). */
  async function freeBytes() {
    const st = await (o.statfs || fsp.statfs)(stageDir || path.join(dir, 'models')).catch(() => (o.statfs || fsp.statfs)(dir).catch(() => null));
    return st ? Number(st.bavail) * Number(st.bsize) : null;
  }
  const diskFull = (file, free) =>
    Object.assign(
      new Error(`Not enough disk space for ${file.name}${free != null ? ` (${Math.round(free / GB)} GB free, needs about ${Math.ceil(((file.size || 0) + 2 * GB) / GB)} GB)` : ''}. Remove a maker or a chat model you don't use.`),
      { permanent: true, disk: true },
    );
  /** Throws (and the file waits) when the disk can't take `bytes` more, with 2 GB to spare. */
  async function roomFor(file, bytes) {
    const free = await freeBytes();
    if (free != null && bytes > 0 && free < bytes + 2 * GB) throw diskFull(file, free);
  }

  async function fetchFile(file) {
    const dest = modelPath(file);
    const part = partPath(file);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.mkdir(path.dirname(part), { recursive: true });
    // Kept in R2 already: bring it down in parallel pieces (much faster than the model's home site).
    const kept = r2 ? await r2.head(modelKey(file)).catch(() => null) : null;
    if (kept && (!file.size || kept.size === file.size)) {
      await roomFor(file, kept.size);
      begin(file, 'cloud storage', 0, kept.size);
      download.ctrl = new AbortController();
      try {
        await downloadFile(r2, modelKey(file), part, { onBytes: tick, signal: download.ctrl.signal });
      } catch (err) {
        // A copy from cloud storage is laid out full size before its pieces arrive, so a half one can't
        // be told from a whole one: drop it (it comes down again quickly) rather than count it as here.
        await fsp.rm(part, { force: true });
        throw err;
      }
      await place(part, dest, file);
      return;
    }
    const have = (await fsp.stat(part).catch(() => null))?.size || 0;
    await roomFor(file, (file.size || 0) - have);
    // Most files come from Hugging Face; a few only from their makers' own site (`url`, pix2pix-turbo's LoRA).
    // A file pinned to a revision (Live Draw's engines: sizes are checked exactly) comes from that commit.
    const url = file.url || `https://huggingface.co/${file.repo}/resolve/${file.revision || 'main'}/${file.path.split('/').map(encodeURIComponent).join('/')}`;
    if (file.gated && !hfToken) throw Object.assign(new Error(TOKEN_MESSAGE), { permanent: true });
    const headers = { ...(have ? { range: `bytes=${have}-` } : {}), ...(file.gated ? { authorization: `Bearer ${hfToken}` } : {}) };
    // A connection that stops sending is cut after STALL_DOWNLOAD_MS and the file picks up where it was.
    const ctrl = new AbortController();
    download.ctrl = ctrl;
    let quiet = null;
    const hush = () => {
      clearTimeout(quiet);
      quiet = setTimeout(() => ctrl.abort(), o.stallDownloadMs ?? STALL_DOWNLOAD_MS);
      quiet.unref?.();
    };
    hush();
    let res;
    try {
      res = await f(url, { headers, redirect: 'follow', signal: ctrl.signal });
    } catch (err) {
      clearTimeout(quiet);
      if (download.paused) throw Object.assign(new Error('paused'), { paused: true });
      throw ctrl.signal.aborted ? new Error(`download ${file.name}: the connection stalled`) : err;
    }
    if (file.gated && (res.status === 401 || res.status === 403)) throw Object.assign(new Error(TOKEN_REFUSED), { permanent: true });
    if (!res.ok || !res.body) {
      clearTimeout(quiet);
      throw new Error(`download ${file.name}: ${res.status}`);
    }
    const resumed = res.status === 206;
    begin(file, hostOf(url), resumed ? have : 0, file.size || Number(res.headers.get('content-length')) || 0);
    const counter = new TransformStream({
      transform(chunk, c) {
        hush();
        tick(chunk.byteLength);
        c.enqueue(chunk);
      },
    });
    try {
      await pipeline(Readable.fromWeb(res.body.pipeThrough(counter)), fs.createWriteStream(part, { flags: resumed ? 'a' : 'w' }));
    } catch (err) {
      if (download.paused) throw Object.assign(new Error('paused'), { paused: true });
      if (ctrl.signal.aborted) throw new Error(`download ${file.name}: the connection stalled; picking up where it was`);
      if (err.code === 'ENOSPC') throw diskFull(file);
      throw err;
    } finally {
      clearTimeout(quiet);
    }
    const size = (await fsp.stat(part)).size;
    if (file.size && size !== file.size) throw new Error(`download ${file.name}: got ${size} of ${file.size} bytes`);
    if (stageDir) begin(file, 'the drive', 0, size, true);
    await place(part, dest, file);
    // Keep a copy in R2 so the next start doesn't download it from its home site again.
    if (r2) {
      begin(file, 'cloud storage', 0, size, true);
      download.ctrl = new AbortController();
      // Pause stops this too: the file is here; only its cloud copy waits for the next time.
      await uploadFile(r2, dest, modelKey(file), { onBytes: tick, signal: download.ctrl.signal }).catch((err) =>
        log.warn?.(`[studio] could not keep ${file.name} in R2: ${err.message}`),
      );
    }
  }

  async function downloadAll() {
    if (download.running || download.paused) return;
    download.running = true;
    try {
      // The list is read again after every file, so makers installed meanwhile are picked up.
      for (;;) {
        if (download.paused) break;
        let next = null;
        for (const file of neededFiles()) {
          if (download.done.has(fid(file)) || blocked.has(fid(file))) continue;
          if (await haveFile(file)) download.done.add(fid(file));
          else {
            next = file;
            break;
          }
        }
        if (!next) {
          await setUpEnvs();
          break;
        }
        const t0 = Date.now();
        try {
          logDownload('start', `Downloading ${next.name}`);
          await fetchFile(next);
          download.error = null;
          download.done.add(fid(next));
          const s = Math.max(1, Math.round((Date.now() - t0) / 1000));
          logDownload('done', `Finished ${next.name} (${(next.size ? next.size / GB : 0).toFixed(1)} GB in ${s < 120 ? `${s} s` : `${Math.round(s / 60)} min`})`);
        } catch (err) {
          // Nothing is coming down while it waits to try again (or stops).
          download.current = null;
          if (err.paused || download.paused) {
            logDownload('paused', `Paused ${next.name}`);
            break;
          }
          download.error = err.message;
          if (err.permanent) {
            blocked.set(fid(next), err.message);
            logDownload('blocked', `${next.name}: ${err.message}`);
            log.warn?.(`[studio] ${next.name}: ${err.message}`);
            continue;
          }
          logDownload('retry', `${err.message}. Trying again in ${Math.round((o.retryMs ?? 30_000) / 1000)} s`);
          log.warn?.(`[studio] ${err.message}; retrying in 30s`);
          await new Promise((r) => setTimeout(r, o.retryMs ?? 30_000));
        } finally {
          download.ctrl = null;
        }
      }
    } finally {
      download.current = null;
      download.running = false;
      // Resumed while this loop was still stopping: start the next one now.
      if (download.again && !download.paused) {
        download.again = false;
        void downloadAll();
      }
    }
  }

  /** Where a file comes from, in words. */
  function hostOf(url) {
    try {
      const h = new URL(url).hostname;
      return /huggingface\.co$/.test(h) ? 'Hugging Face' : h.replace(/^www\./, '');
    } catch {
      return 'the web';
    }
  }

  /**
   * The download manager: what is coming down, how fast, what waits behind it and why, what
   * gave up, and what happened lately. One file comes down at a time (the disk and the line are
   * shared), so this also says what the bottleneck is.
   */
  async function downloads() {
    const owners = new Map();
    for (const m of kept()) for (const file of makerFiles(m)) owners.set(fid(file), [...(owners.get(fid(file)) ?? []), m.name]);
    const c = download.current && download.running && !download.paused ? download.current : null;
    const speed = speedOf(c);
    const queue = [];
    for (const file of neededFiles()) {
      const id = fid(file);
      if (download.done.has(id) || (c && c.id === id)) continue;
      if (await haveFile(file)) continue;
      const part = (await fsp.stat(partPath(file)).catch(() => null))?.size || 0;
      queue.push({ id, name: file.name, size: file.size || 0, have: part, makers: owners.get(id) ?? [], problem: blocked.get(id) || null });
    }
    const waiting = queue.filter((q) => !q.problem);
    const left = (c ? Math.max(0, c.total - c.completed) : 0) + waiting.reduce((t, q) => t + Math.max(0, q.size - q.have), 0);
    const free = await freeBytes();
    const state = download.paused ? 'paused' : c ? (c.saving ? 'saving' : 'downloading') : waiting.length ? (download.error ? 'retrying' : 'starting') : queue.length ? 'blocked' : 'idle';
    return {
      state,
      paused: download.paused,
      current: c
        ? {
            name: c.name,
            makers: owners.get(c.id) ?? [],
            source: c.source,
            saving: Boolean(c.saving),
            completed: c.completed,
            total: c.total,
            percent: c.total ? Math.min(100, Math.floor((c.completed / c.total) * 100)) : 0,
            bytesPerSec: speed,
            etaSeconds: speed && c.total ? Math.round(Math.max(0, c.total - c.completed) / speed) : null,
            startedAt: new Date(c.startedAt).toISOString(),
          }
        : null,
      queue,
      done: download.done.size,
      bytesLeft: left,
      // At today's speed: a rough guide for everything still to come.
      etaSeconds: speed && left ? Math.round(left / speed) : null,
      lastError: download.error,
      diskFree: free,
      bottleneck: bottleneck(state, c, speed, waiting.length, queue.length - waiting.length, free, left),
      log: download.log.slice(-40),
    };
  }

  function bottleneck(state, c, speed, waiting, stuck, free, left) {
    const mb = (b) => `${Math.round(b / 1e6)} MB/s`;
    if (state === 'paused') return 'Downloads are paused. Resume to carry on from where they stopped.';
    if (state === 'idle') return 'Nothing to download: everything you added is here.';
    if (state === 'blocked') return `${stuck} file${stuck === 1 ? ' is' : 's are'} stuck (see why below). Fix that, then Resume.`;
    if (free != null && left > free) return `Not enough disk for everything still to come (${Math.ceil(left / GB)} GB left, ${Math.floor(free / GB)} GB free).`;
    if (state === 'retrying') return `The last try failed (${download.error}). It tries again by itself.`;
    if (!c) return 'Starting the next file…';
    if (speed != null && speed < 5e6) return `Slow: ${c.name} is coming from ${c.source} at only ${mb(speed)}. That site is the bottleneck, not your machine.`;
    const why = c.saving ? `saving ${c.name} to cloud storage, so the next start is quick` : `downloading ${c.name} from ${c.source}${speed ? ` at ${mb(speed)}` : ''}`;
    return `One file at a time: ${why}.${waiting ? ` ${waiting} more wait${waiting === 1 ? 's' : ''} behind it.` : ''}`;
  }

  /** Pause stops the file under way (it picks up where it was); resume starts again, gave-up files included. */
  function pauseDownloads() {
    if (!download.paused) logDownload('paused', 'Paused by you');
    download.paused = true;
    download.ctrl?.abort();
  }
  function resumeDownloads() {
    const was = download.paused;
    download.paused = false;
    // Gave up on a full disk or a refused file: try those again too.
    if (blocked.size) {
      logDownload('resume', `Trying ${blocked.size} stopped file${blocked.size === 1 ? '' : 's'} again`);
      blocked.clear();
    }
    if (was) logDownload('resume', 'Resumed by you');
    // The paused loop may still be winding down (pieces under way finish first): start again after it.
    if (download.running) download.again = true;
    void downloadAll();
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
      if (download.done.has(fid(file))) done += file.size || 0;
      // Downloaded and being copied to cloud storage: here already.
      else if (download.current?.id === fid(file)) done += download.current.saving ? file.size || download.current.total : download.current.completed;
    }
    return { total, done };
  }

  async function makers() {
    const out = [];
    for (const m of MAKERS) {
      if (drawingOnly(m)) continue;
      const list = makerFiles(m);
      let installed = true;
      for (const file of list) if (!(await haveFile(file))) installed = false;
      const { total, done } = bytesDone(list);
      // Live video makers also need their own Python (live_env.sh), set up once their files are here.
      const env = m.env && o.liveEnvs ? o.liveEnvs.state(m.env) : null;
      const filesHere = installed;
      const why = list.map((file) => blocked.get(fid(file))).find(Boolean) || null;
      const mine = list.some((file) => download.current?.id === fid(file));
      if (env && !env.ready) installed = false;
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
        problem: why || env?.error || null,
        // Only on the Turbo machine (80 GB of GPU memory): Krea Realtime.
        turboOnly: Boolean(m.turboOnly) || undefined,
        // Its files are here and its Python is being set up: what it is doing.
        setup: filesHere && env?.installing ? env.step || 'Setting up' : undefined,
        builtIn: Boolean(m.builtIn),
        wanted: keeps(m),
        installed,
        size: total,
        percent: installed ? 100 : filesHere ? 99 : total ? Math.min(99, Math.floor((done / total) * 100)) : 0,
        // Not installed yet: what is happening to it right now (so a number that doesn't move says why).
        status: installed
          ? undefined
          : why
            ? /disk space/.test(why)
              ? 'disk'
              : 'blocked'
            : !keeps(m)
              ? undefined
              : mine
                ? download.current.saving
                  ? 'saving'
                  : 'downloading'
                : filesHere
                  ? 'setup'
                  : download.running
                    ? 'waiting'
                    : 'paused',
        waitingFor: !installed && !why && download.current && !mine ? download.current.name : undefined,
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
    if (drawingOnly(m)) throw Object.assign(new Error(`${m.name} runs on the drawing machine. Open Live Draw to use it.`), { status: 409 });
    if (!hfToken && makerFiles(m).some((file) => file.gated) && !(await makerReady(m))) throw Object.assign(new Error(TOKEN_MESSAGE), { status: 400, needsToken: true });
    // Krea Realtime needs 40 GB+ of GPU memory (and 30 GB of files): refused on the Standard machine.
    if (m.turboOnly && (await o.gpuMemory?.().catch(() => 0)) < (o.turboBytes ?? 70e9)) throw Object.assign(new Error(o.turboMessage || 'This maker needs the Turbo machine (80 GB).'), { status: 409, turbo: true });
    // Refused up front when its files can't fit (with 2 GB to spare), instead of stopping half way.
    // What is left to download: a file half-way down (.part) only needs the rest, as fetchFile counts it.
    // Staged downloads (a global volume) only need room for the biggest file at a time.
    let need = 0;
    for (const file of makerFiles(m)) {
      if (await haveFile(file)) continue;
      const part = await fsp.stat(partPath(file)).catch(() => null);
      const left = Math.max(0, (file.size || 0) - (part?.size || 0));
      need = stageDir ? Math.max(need, left) : need + left;
    }
    const free = need ? await freeBytes() : null;
    if (free != null && free < need + 2 * GB) {
      throw Object.assign(
        new Error(`Not enough disk space for ${m.name}: needs about ${Math.ceil((need + 2 * GB) / GB)} GB, ${Math.floor(free / GB)} GB free. Remove a maker or a chat model you don't use first.`),
        { status: 507, disk: true },
      );
    }
    if (m.kind === 'style' && !(m.for && (makerById(m.for)?.builtIn || wanted.has(m.for)))) {
      wanted.add(m.for);
    }
    wanted.add(id);
    await saveWanted();
    // Adding one already wanted resumes it: its files get another try (a file the download gave up
    // on, or one that was counted as done and then went missing).
    for (const file of makerFiles(m)) {
      blocked.delete(fid(file));
      download.done.delete(fid(file));
    }
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
    // Space was freed: files that were waiting for it can try again.
    for (const [k, why] of blocked) if (/disk space/.test(why)) blocked.delete(k);
    // Styles go with their maker.
    for (const s of MAKERS) if (s.for === id) wanted.delete(s.id);
    await saveWanted();
    const keep = new Set(neededFiles().map(fid));
    for (const file of makerFiles(m)) {
      if (keep.has(fid(file))) continue;
      download.done.delete(fid(file));
      await fsp.rm(modelPath(file), { force: true });
      await fsp.rm(partPath(file), { force: true });
      if (r2) await r2.remove(modelKey(file)).catch(() => {});
    }
    // Its own Python goes too (unless another kept maker uses it).
    if (m.env && o.liveEnvs && !kept().some((x) => x.env === m.env)) await o.liveEnvs.remove(m.env).catch(() => {});
    return makers();
  }

  async function makerReady(m) {
    for (const file of makerFiles(m)) if (!(await haveFile(file))) return false;
    return true;
  }

  /** Live video makers whose files are here: set up their Python (once; live_env.sh). */
  async function setUpEnvs() {
    if (!o.liveEnvs || helper) return;
    for (const m of kept()) if (m.env && !o.liveEnvs.ready(m.env) && (await makerReady(m))) o.liveEnvs.ensure(m.env);
  }

  function kindProgress(kind) {
    let total = 0;
    let done = 0;
    for (const file of files[kind]) {
      total += file.size || 0;
      if (download.done.has(fid(file))) done += file.size || 0;
      else if (download.current?.id === fid(file)) done += download.current.completed;
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
    return (await fsp.readFile(path.join(dir, perRole('state')), 'utf8').catch(() => 'installing')).trim();
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
    // Swap a person: finding who, preparing the input, sampling, decoding.
    swap: { 33: [1, 4], 50: [4, 10], 60: [10, 93], 61: [93, 99] },
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
  const timingsPath = path.join(dir, perRole('timings', '.json'));
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
      owner: j.owner || undefined,
      character: j.character || undefined,
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

  /** One picture of a saved character (a file on this machine) as ComfyUI input. */
  async function copyFromSheet(entry) {
    const given = typeof entry === 'string' ? entry : entry?.file || entry?.path;
    if (typeof given !== 'string' || !given) throw bad('That character has a picture that cannot be read.');
    const src = path.isAbsolute(given) ? given : path.resolve(dir, given);
    const buf = await fsp.readFile(src).catch(() => null);
    const ext = buf && sniffImage(buf);
    if (!ext) throw bad("One of that character's pictures cannot be read.", 404);
    const name = `orbit-${newId()}${ext}`;
    await fsp.mkdir(path.join(dir, 'input'), { recursive: true });
    await fsp.writeFile(path.join(dir, 'input', name), buf);
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
   *   swap     16 fps, up to 81 frames (4k + 1), fitted in 832 × 480 (multiples of 16)
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
    if (plan === 'swap') {
      fps = SWAP_FPS;
      [width, height] = fitSize(info.width, info.height, { long: 832, short: 480, multiple: 16 });
      frames = vaceFrames(dur, SWAP_MAX_FRAMES);
      if (frames < 5) throw bad('That video is too short (it needs at least half a second).');
      seconds = frames / SWAP_FPS;
    } else if (plan === 'vace' || plan === 'extend') {
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

  /** A picture on this machine as a starting picture (a character's sheet picture, or one the sheet is built from). */
  async function copyInput(src) {
    const name = `orbit-${newId()}${path.extname(src).toLowerCase() || '.png'}`;
    await fsp.mkdir(path.join(dir, 'input'), { recursive: true });
    await fsp.copyFile(src, path.join(dir, 'input', name));
    return name;
  }
  /** The saved character a job names (one made for someone else is theirs alone; only once its sheet is accepted). */
  async function characterFor(req) {
    const c = await characters?.get?.(String(req.character).slice(0, 80));
    if (!c || (c.owner && c.owner !== (typeof req.owner === 'string' ? req.owner : ''))) throw bad('That character is not in your library any more.', 404);
    if (c.adult !== true || c.fictional !== true) throw Object.assign(new Error(CHARACTER_MESSAGE), { status: 422, blocked: true });
    if (!Array.isArray(c.sheet) || !c.sheet.length) throw bad('That character has no pictures yet.');
    return c;
  }

  /**
   * Start a job. req: { kind: 'image'|'video', maker?, prompt, size?, seconds?, style?,
   *   image? (data URL), images? (data URLs, for edits), fromItem? (gallery id),
   *   endImage? (data URL: the picture a video ends on), toItem? (gallery picture to end on),
   *   videoItem? (gallery video to work on) or videoUpload? (upload id), audioUpload? (upload id),
   *   task? (Wan VACE: replace | restyle | extend | motion), target? (words: what to replace or erase),
   *   change? (LTX-2.5 video to video: 'little' | 'lot') }.
   *   character? (a saved character's id: its description goes first and its sheet pictures start the job),
   *   seed? (a whole number: the same seed gives the same start).
   * `internal` never comes from a request: { refs: [pictures on this machine to start from] }.
   * Throws errors with .status for bad requests.
   */
  async function createJob(req, internal = {}) {
    const maker = req.maker ? makerById(String(req.maker)) : makerById(req.kind === 'video' ? 'ltx' : 'qwen');
    // Live makers (live.js) answer on their own connection, not as jobs.
    if (!maker || maker.kind === 'style' || maker.kind === 'live') throw Object.assign(new Error('No such maker.'), { status: 400 });
    const mode = maker.kind; // image | video | edit | upscale | videoedit | sketch
    // Which recipe: krea (Krea 2 family), qwen (Qwen Image family), ltx, ltx25, h3 or s2v (video),
    // vace or seedvr2 (video edits).
    const flow = maker.workflow || (maker.id === 'krea-real' ? 'krea' : maker.id === 'h3-max' ? 'h3' : mode === 'video' ? 'ltx' : 'qwen');
    const kind = mode === 'video' || mode === 'videoedit' ? 'video' : 'image';
    // Wan VACE: what to do with the video (Erase from video always erases).
    const task = flow === 'vace' ? maker.task || (maker.tasks?.includes(String(req.task)) ? String(req.task) : maker.tasks?.[0] || 'replace') : null;
    const swap = flow === 'swap';
    const needs = new Set(maker.needs || []);
    if (task === 'replace' || task === 'erase' || swap) needs.add('target');
    if (swap) needs.add('photo');
    if (task === 'motion') needs.add('photo');
    // A saved character (characters.js): its description goes first in what the makers read, and its
    // sheet pictures stand in for the photo you would have added.
    const character = req.character != null && req.character !== '' ? await characterFor(req) : null;
    let prompt = String(req.prompt || '').trim().slice(0, 4000);
    if (character && (mode === 'image' || mode === 'video')) prompt = injectCharacter(prompt, character).slice(0, 4000);
    const target = String(req.target || '').trim().slice(0, 200);
    // Sharpening and erasing need no description; a talking photo has a default one.
    const promptOptional = mode === 'upscale' || flow === 'seedvr2' || task === 'erase' || flow === 's2v' || swap;
    if (!prompt && !promptOptional) throw bad(mode === 'edit' || mode === 'videoedit' ? 'Describe the change.' : mode === 'sketch' ? 'Say what your drawing is.' : 'Describe what to make.');
    if (needs.has('target') && !target) {
      throw bad(swap ? 'Say who to replace, e.g. “the man in the red jacket”.' : task === 'erase' ? 'Say what to erase, e.g. “the man in the red shirt”.' : 'Say what to replace, e.g. “the red car”.');
    }
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
    // A drawing made in Live draw isn't a photo (a gallery picture used as the drawing keeps its own rule).
    const photo = (mode !== 'sketch' && uploads.length > 0) || Boolean(endUpload) || Boolean(source?.photo) || Boolean(toSource?.photo) || (withVideo && (Boolean(videoUpload) || Boolean(videoSource?.photo)));
    // Made from an NSFW picture or video: NSFW too, before anyone has looked.
    const nsfwSource = Boolean(source?.nsfw) || Boolean(toSource?.nsfw) || (withVideo && Boolean(videoSource?.nsfw));
    // A character is the other way to name a person for Swap a person: never mixed with a photo (a character is made-up, a photo may not be).
    if (character && swap && (uploads.length || req.fromItem)) throw bad('Pick a character or add a photo, not both.');
    // An adult swap: a fictional adult character in a video made here from words alone. Nothing about a real
    // person's photo or an upload can be in it (photo is false only when no upload is anywhere in its past).
    const wantsAdult = swap && req.adult === true;
    const adultSwap = Boolean(swap && character && withVideo && videoSource && !videoUpload && !photo && (await provenance(videoSource)).ok);
    if (swap) {
      // A real person's photo goes into the video: adults only, never sexual, never into an NSFW video.
      if (mentionsMinor(`${target} ${prompt}`)) throw Object.assign(new Error(SWAP_MINOR_MESSAGE), { status: 422, blocked: true });
      if (adultSwap ? blockedTarget(target) : blockedSwap(target, prompt)) throw Object.assign(new Error(PHOTO_MESSAGE), { status: 422, blocked: true });
      if (!adultSwap && (nsfwSource || videoSource?.nsfwUser === true || source?.nsfwUser === true || wantsAdult)) {
        throw Object.assign(new Error(character || wantsAdult ? ADULT_SWAP_MESSAGE : SWAP_NSFW_MESSAGE), { status: 422, blocked: true });
      }
    }
    if (photo) {
      const refused =
        blockedForPhoto(prompt) || (task === 'erase' ? blockedTarget(target) : task === 'replace' ? blockedReplace(target, prompt) : target ? blockedForPhoto(target) : false);
      if (refused) throw Object.assign(new Error(PHOTO_MESSAGE), { status: 422, blocked: true });
    }
    if (needs.has('video') && !withVideo) throw bad('Add the video to work on.');
    if (needs.has('audio') && !audioUpload) throw bad('Add a voice recording or a song.');
    if (needs.has('photo') && !uploads.length && !req.fromItem && !character) throw bad(task === 'motion' ? 'Add a photo of who should move.' : swap ? 'Add a photo of the new person.' : 'Add a photo of the person.');
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
      clip = await prepClip(src, flow === 'ltx25' ? 'ltx25' : flow === 'seedvr2' ? 'seedvr2' : swap ? 'swap' : task === 'extend' ? 'extend' : 'vace');
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
    for (const src of internal.refs || []) inputs.push(await copyInput(src));
    // A character's sheet pictures start the job when no photo does (outfit swap: the person, then your outfit picture;
    // Swap a person: the front, then the face close-up). The sheet comes ordered: the front first, the face close-up second.
    if (character && (mode === 'edit' || swap || task === 'motion' || flow === 's2v' || (mode === 'video' && !withVideo)) && (!inputs.length || maker.twoImages)) {
      if (character.sheet[0]?.view && character.sheet[0].view !== 'front') throw bad("That character's pictures are not on this machine yet. Open Characters to make them again.", 409);
      const pics = [];
      for (const entry of character.sheet.slice(0, swap ? 2 : 1)) pics.push(await copyFromSheet(entry));
      inputs.unshift(...pics);
    }
    const need = mode === 'edit' ? (maker.twoImages ? 2 : 1) : mode === 'upscale' || mode === 'sketch' ? 1 : 0;
    if (inputs.length < need) {
      throw Object.assign(new Error(maker.twoImages ? 'Add two pictures: the person first, then the outfit.' : mode === 'sketch' ? 'Draw something first.' : 'Add the picture to start from.'), { status: 400 });
    }

    // A locked seed (a character's sheet keeps one seed for every view).
    const seed = Number.isInteger(req.seed) && req.seed >= 0 && req.seed < 2 ** 31 ? req.seed : undefined;
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
      const shown =
        prompt ||
        (task === 'erase' ? `Erased: ${target}${videoSource?.prompt ? ` · ${videoSource.prompt}` : ''}` : swap ? `Swapped a person: ${target}` : videoSource?.prompt || 'Sharpened video');
      if (swap) {
        // The new person: the photo, then the face close-up when there is one.
        ({ width, height } = clip);
        seconds = Math.round((clip.frames / SWAP_FPS) * 10) / 10;
        workflow = swapWorkflow({ video: clip.name, width, height, frames: clip.frames, target, photo: inputs[0], face: inputs[1] || null, prefix });
        stages = 'swap';
      } else if (flow === 'seedvr2') {
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
      workflow = editWorkflow({ prompt, images: inputs.slice(0, need), lora, strength: maker.strength ?? 1, prefix, seed });
    } else if (mode === 'sketch') {
      // Your drawing, finished: Z-Image-Turbo follows its lines (Fun ControlNet Union 2.1).
      [width, height] = SIZES.sketch[req.size] || SIZES.sketch.square;
      // Strokes on a transparent background (Live Draw) are laid on white; a second picture (Live Draw's
      // canvas as it looks) is where the finished picture starts from.
      const sketchSize = await pngSize(path.join(dir, 'input', inputs[0]));
      workflow = zimageSketchWorkflow({
        prompt,
        sketch: inputs[0],
        width,
        height,
        strength: sketchStrength(req.follow),
        prefix,
        sketchSize,
        start: inputs[1] || null,
        denoise: req.startStrength,
      });
    } else if (mode === 'upscale') {
      prompt = prompt || 'Sharpened 4×';
      workflow = upscaleWorkflow({ image: inputs[0], prefix, model: FILES[maker.files[0]].name });
      stages = 'upscale';
    } else if (flow === 'krea') {
      [width, height] = SIZES.krea[req.size] || SIZES.krea.portrait;
      workflow = kreaWorkflow({ prompt, width, height, style, trigger: styleTrigger, unet: FILES[maker.files[0]].name, prefix, seed });
    } else {
      [width, height] = SIZES.image[req.size] || SIZES.image.square;
      workflow =
        maker.id === 'qwen'
          ? imageWorkflow({ prompt, width, height, prefix, seed })
          : qwenWorkflow({
              unet: FILES[maker.files[0]].name,
              prompt,
              width,
              height,
              seed,
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
      // The style picked on top of the maker, so the Lab can remix it the same way (remix.js).
      style: style ? String(req.style) : undefined,
      background: Boolean(req.background),
      // A studio member's job (gate.js sets it from their key, never from the request body).
      owner: typeof req.owner === 'string' && req.owner ? req.owner.slice(0, 120) : undefined,
      photo,
      // Made from an NSFW picture or video, or asked to be adult (an allowed adult swap): NSFW before anyone has looked.
      nsfwSource: nsfwSource || (adultSwap && wantsAdult),
      // What it started from (gallery ids): the trail an adult swap's origin is checked along.
      sources: [fromId, req.toItem, req.videoItem].filter((x) => typeof x === 'string' && x).map(String),
      character: character ? { id: String(character.id), name: String(character.name || '').slice(0, 80) } : undefined,
      adultSwap: adultSwap || undefined,
      // What was asked, kept with a held result so the owner sees it (never the uploads themselves).
      request: swap
        ? {
            target,
            prompt: String(req.prompt || '').slice(0, 500),
            videoItem: req.videoItem ? String(req.videoItem) : undefined,
            videoUpload: Boolean(videoUpload) || undefined,
            photoUpload: uploads.length > 0 || undefined,
            fromItem: req.fromItem ? String(req.fromItem) : undefined,
            character: character ? String(character.id) : undefined,
            adult: wantsAdult || undefined,
          }
        : undefined,
      workflow,
      status: 'queued',
      progress: 0,
      attempts: 1,
      notes: [],
      // Drawings about children: a result the NSFW check flags is thrown away, not just blurred.
      minorGuard: mode === 'sketch' && mentionsMinor(`${prompt} ${target}`),
      // Swap a person: looked at before anyone sees it; an NSFW one (or one the check missed) is never kept.
      photoGuard: swap || undefined,
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
      // Others using the graphics card (Live draw) make way for a video, which needs all of it.
      if (job.kind === 'video') await o.makeWayForVideo?.().catch(() => {});
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
        style: job.style || undefined,
        photo: job.photo || undefined,
        sources: job.sources,
        character: job.character,
        adultSwap: job.adultSwap,
        request: job.request,
        nsfw: job.nsfwSource || undefined,
        // Made by the meme lab: kept out of the gallery until you keep it.
        lab: job.background || undefined,
        minorGuard: job.minorGuard || undefined,
        photoGuard: job.photoGuard || undefined,
        owner: job.owner || undefined,
        file,
        createdAt: job.createdAt,
      };
      await fsp.mkdir(metaDir, { recursive: true });
      // A real person's photo in a video: not in the gallery at all until the check has looked and found
      // it fine (rate() writes its note then); NSFW, or not looked at, and its file is deleted.
      if (item.photoGuard) {
        const r = await rate(item);
        const outcome = outcomes.get(item.id);
        outcomes.delete(item.id);
        // A result that could show someone under 18 is removed; any other doubt sets it aside for the owner.
        if (outcome === 'removed') throw new Error(BLOCKED_MESSAGE);
        if (outcome === 'held') throw new Error(PHOTO_MESSAGE);
        if (!r) {
          await holdItem(item, { reason: HOLD_REASON.unchecked, category: 'checker-unavailable' });
          throw new Error(CHECK_MESSAGE);
        }
      } else {
        await fsp.writeFile(path.join(metaDir, `${job.id}.json`), JSON.stringify(item));
        await keep(item);
      }
      // About children: looked at before anyone sees it (rate() removes an NSFW one).
      if (item.minorGuard) {
        await rate(item);
        if (!(await readItem(item.id))) throw new Error(BLOCKED_MESSAGE);
      }
      job.item = item;
      job.progress = 100;
      job.status = 'done';
      await learn(job);
      if (!item.nsfw && !item.minorGuard && !item.photoGuard) void rate(item);
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
    const pidFile = path.join(dir, `machine-${role}`, 'comfy.pid');
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
  // The first time a gallery that lived only on this machine's drive meets R2 (a network volume
  // with GALLERY=r2), everything on the drive is copied up first, and nothing is dropped until it is:
  // a note missing from R2 then means "not there yet", not "deleted". The marker says it is done.
  let synced = 0;
  let syncing = null;
  const backfilledMarker = path.join(dir, 'output', '.r2-gallery-copied');
  let backfilling = null;
  async function backfill(names) {
    for (const n of names) {
      const it = await fsp
        .readFile(path.join(metaDir, n), 'utf8')
        .then(JSON.parse)
        .catch(() => null);
      if (it?.id && it.file) await keep(it);
    }
    await fsp.mkdir(path.dirname(backfilledMarker), { recursive: true });
    await fsp.writeFile(backfilledMarker, new Date(now()).toISOString());
    if (names.length) log.info?.(`[studio] copied ${names.length} gallery items from this drive to R2`);
  }
  async function syncGallery() {
    if (!mirror || now() - synced < 20_000) return;
    syncing ||= (async () => {
      try {
        const there = new Set(await mirror.pull('orbit/', (rel) => /^orbit\/[A-Za-z0-9_-]+\.json$/.test(rel)));
        const copied = Boolean(await fsp.stat(backfilledMarker).catch(() => null));
        const onlyHere = [];
        for (const n of await fsp.readdir(metaDir).catch(() => [])) {
          if (!n.endsWith('.json') || there.has(`orbit/${n}`)) continue;
          // Just made here and still on its way up: keep it.
          const st = await fsp.stat(path.join(metaDir, n)).catch(() => null);
          if (!st) continue;
          if (!copied) onlyHere.push(n);
          else if (now() - st.mtimeMs > 5 * 60_000) await fsp.rm(path.join(metaDir, n), { force: true });
        }
        if (!copied && !backfilling) {
          backfilling = backfill(onlyHere)
            .catch((err) => log.warn?.(`[studio] could not copy the gallery to R2 yet: ${err.message}`))
            .finally(() => (backfilling = null));
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
  /**
   * A picture or video made in the cloud while this machine was off: fetch it (a data: URL, or an
   * https link on fal.ai's file servers only) and add it to the gallery like anything made here.
   */
  async function importItem({ url, kind, prompt, maker = 'cloud', width, height, seconds }) {
    if (kind !== 'image' && kind !== 'video') throw bad('kind must be image or video');
    const max = kind === 'video' ? 300 * 1024 * 1024 : 40 * 1024 * 1024;
    let buf;
    let type = '';
    const data = /^data:(image\/(?:png|jpeg|webp)|video\/mp4);base64,([A-Za-z0-9+/=]+)$/.exec(String(url || ''));
    if (data) {
      type = data[1];
      buf = Buffer.from(data[2], 'base64');
    } else {
      let u;
      try {
        u = new URL(String(url));
      } catch {
        throw bad('Not a link');
      }
      // fal.ai's file hosts, and Runpod Serverless results (image.runpod.ai).
      if (u.protocol !== 'https:' || !(/(^|\.)fal\.(media|run|ai)$/.test(u.hostname) || u.hostname === 'image.runpod.ai')) throw bad('Only files from the cloud makers can be added');
      const res = await (o.fetchImpl || fetch)(u, { signal: AbortSignal.timeout(120_000) });
      if (!res.ok) throw bad(`Could not fetch it (${res.status})`, 502);
      if (Number(res.headers.get('content-length')) > max) throw bad('That file is too large', 413);
      type = (res.headers.get('content-type') || '').split(';')[0];
      buf = Buffer.from(await res.arrayBuffer());
    }
    if (buf.length > max) throw bad('That file is too large', 413);
    const ext = kind === 'video' ? '.mp4' : type === 'image/png' ? '.png' : type === 'image/webp' ? '.webp' : '.jpg';
    const rel = path.join('cloud', `${newId()}${ext}`);
    const dest = path.join(dir, 'output', rel);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.writeFile(dest, buf);
    return addItem({ kind, maker: String(maker).slice(0, 40), prompt: String(prompt || '').slice(0, 2000), file: rel, width, height, seconds });
  }

  async function addItem({ kind, maker = 'soreal', prompt, file, seconds, width, height, movie, photo, nsfw, lab, owner }) {
    // lab: a Lab movie's cut, kept out of the gallery until you keep it (like a Lab video).
    const item = { id: newId(), kind, maker, prompt, width, height, seconds, movie, photo: photo || undefined, nsfw: nsfw || undefined, lab: lab || undefined, owner: owner || undefined, file, createdAt: new Date(now()).toISOString() };
    await fsp.mkdir(metaDir, { recursive: true });
    await fsp.writeFile(path.join(metaDir, `${item.id}.json`), JSON.stringify(item));
    await keep(item);
    if (!item.nsfw) void rate(item);
    return item;
  }

  // ---- origin: was it made in the app from words, with no uploaded photo or video anywhere behind it?
  /**
   * { ok } is true only when an item is surely free of uploads. An item made since this check existed lists
   * what it started from (sources) and is followed back; an older one counts only if it was made by a plain
   * picture or video maker from words alone. Anything unknown (imported, a cut movie, a note that is gone) is not ok.
   */
  async function provenance(it, depth = 0, seen = new Set()) {
    if (!it || typeof it !== 'object') return { ok: false, why: 'unknown' };
    if (depth > 8 || seen.has(it.id)) return { ok: false, why: 'unknown' };
    seen.add(it.id);
    if (it.photo || it.photoGuard) return { ok: false, why: 'photo' };
    if (Array.isArray(it.sources)) {
      for (const sid of it.sources) {
        const r = await provenance(await readItem(String(sid)), depth + 1, seen);
        if (!r.ok) return r;
      }
      return { ok: true };
    }
    const kind = makerById(String(it.maker || ''))?.kind;
    if (it.fromImage === false && (kind === 'image' || kind === 'video')) return { ok: true };
    return { ok: false, why: 'unknown' };
  }

  const HOLD_REASON = {
    unchecked: "The safety check couldn't look at this result, so nobody has seen it yet.",
    flagged: "The safety check says this is adult content, on a swap that is not allowed to be adult (it has a real person's photo, or a video not made here).",
  };
  /** What happened to a guarded result inside rate(): 'held' or 'removed' (finish() reads it). */
  const outcomes = new Map();

  /**
   * Set a result aside for the owner: copy it (and its note) to the held area first, and only when that worked
   * take it out of the gallery. If it can't be kept, it is left where it is (out of sight), never deleted.
   */
  async function holdItem(item, { reason, category, score }) {
    const p = await localFile(item);
    if (!p) throw new Error('The result file is missing, so it could not be held.');
    const note = (await readItem(item.id)) || item;
    const rec = { ...note, ...(typeof score === 'number' ? { nsfwScore: score } : {}) };
    // Approving is only for results that could stand in a gallery: a flagged real person's photo or upload never.
    await heldStore.hold({ item: rec, file: p, reason, category, canApprove: category === 'checker-unavailable' || Boolean(item.adultSwap) });
    await remove(item.id);
    await fsp.rm(p, { force: true });
  }

  /** Put an approved result back in its owner's gallery with its note (its NSFW mark kept), and an audit line. */
  async function placeApproved(rec, mediaPath, audit) {
    const item = { ...rec.item };
    const dest = path.resolve(path.join(dir, 'output'), item.file);
    if (!dest.startsWith(path.join(dir, 'output') + path.sep)) throw bad('Not a gallery file.');
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.copyFile(mediaPath, dest);
    item.review = [...(item.review || []), audit];
    await fsp.mkdir(metaDir, { recursive: true });
    await withNote(item.id, async () => {
      await fsp.writeFile(path.join(metaDir, `${item.id}.json`), JSON.stringify(item));
      await keep(item);
    });
    if (typeof item.nsfw !== 'boolean') void rate(item);
  }

  // ---- the NSFW check: look at each picture or video once, and remember the answer in its note.
  const rating = new Set();
  // One read-change-write at a time per note, so the check and your own say never undo each other.
  const noteLocks = new Map();
  function withNote(id, fn) {
    const run = (noteLocks.get(id) || Promise.resolve()).then(fn, fn);
    const tail = run.catch(() => {});
    noteLocks.set(id, tail);
    void tail.then(() => noteLocks.get(id) === tail && noteLocks.delete(id));
    return run;
  }
  /**
   * Look at an item and save whether it is NSFW (nsfw: true | false). Quiet when the checker can't run.
   * Returns the check's answer, or null when it did not look.
   */
  async function rate(item) {
    if (!o.nsfw || rating.has(item.id)) return null;
    rating.add(item.id);
    try {
      const p = await localFile(item);
      if (!p) return null;
      const r = await o.nsfw.check(p, { kind: item.kind, seconds: item.seconds });
      if (!r) return null;
      // A result that could show someone under 18, or a drawing about children that came out NSFW, is never
      // kept (the one thing that is not held for review: keeping it would be unlawful).
      if ((r.minor === true && (item.photoGuard || item.minorGuard)) || (r.nsfw && item.minorGuard)) {
        log.warn?.(`[nsfw] ${item.id}: ${item.minorGuard ? 'NSFW result from a prompt about children' : 'a result that could show someone under 18'}, removed`);
        await remove(item.id);
        await fsp.rm(path.join(dir, 'output', item.file), { force: true });
        outcomes.set(item.id, 'removed');
        return r;
      }
      // Adult content where it is not allowed (a real person's photo, or a video not made here): not shown, not
      // deleted: set aside for the owner to look at. An allowed adult swap (a character made here, a video
      // made here) just gets its NSFW mark and shows blurred.
      if (r.nsfw && item.photoGuard && !item.adultSwap) {
        await holdItem(item, { reason: HOLD_REASON.flagged, category: 'flagged', score: r.score });
        outcomes.set(item.id, 'held');
        return r;
      }
      // Read the note again: it may have changed meanwhile (kept from the Lab, or your own say).
      await withNote(item.id, async () => {
        const latest = (await readItem(item.id)) || item;
        latest.nsfw = r.nsfw || Boolean(latest.nsfw);
        latest.nsfwScore = r.score;
        item.nsfw = latest.nsfw;
        await fsp.writeFile(path.join(metaDir, `${item.id}.json`), JSON.stringify(latest));
        await keep(latest);
      });
      return r;
    } catch (err) {
      log.warn?.(`[nsfw] ${item.id}: ${err.message}`);
      return null;
    } finally {
      rating.delete(item.id);
    }
  }

  /**
   * Your own say on an item, which beats the check: true blurs it (the check missed it), false never
   * blurs it (the check or its words got it wrong), null hands it back to the check.
   */
  function markNsfw(id, nsfw) {
    return withNote(id, async () => {
      const it = await readItem(id);
      if (!it) return null;
      if (typeof nsfw === 'boolean') it.nsfwUser = nsfw;
      else delete it.nsfwUser;
      await fsp.writeFile(path.join(metaDir, `${id}.json`), JSON.stringify(it));
      await keep(it);
      return it;
    });
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
    busy: () => download.running || Boolean(o.liveEnvs?.busy()) || active().some((j) => !j.background && now() - (j.startedAt || Date.parse(j.createdAt)) < STUCK_JOB_MS),
    hasUserWork,
    /** A chat needs the GPU: hand it back from ComfyUI now if nothing is being made. */
    async yieldGpu() {
      if (!comfyHoldsGpu || active().length) return;
      comfyHoldsGpu = false;
      await comfyJson('/free', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ unload_models: true, free_memory: true }) }).catch(
        () => {},
      );
    },
    /** A maker's files are all on this machine (live makers use them outside ComfyUI). */
    async makerInstalled(id) {
      const m = makerById(id);
      return Boolean(m && (await makerReady(m)) && (!m.env || !o.liveEnvs || o.liveEnvs.ready(m.env)));
    },
    /** Where a model file is on disk (live makers load them themselves). */
    modelPath,
    /** The studio folder (live video saves its clips under output/). */
    dir,
    /** Make room on the graphics card for a live maker: chat models out, ComfyUI's models freed if idle. */
    async makeRoom() {
      // A meme-lab video only fills quiet time: it stops for you, as it does for your own jobs.
      const lab = inFlight();
      if (lab?.background) {
        note(lab, 'Made way for Live draw.');
        await cancel(lab.id).catch(() => {});
      }
      await unloadChatModels();
      if (!active().length) {
        comfyHoldsGpu = false;
        await comfyJson('/free', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ unload_models: true, free_memory: true }) }).catch(() => {});
      }
    },
    /** A video you asked for is being made (it needs the whole graphics card: live previews wait). */
    videoInFlight: () => active().some((j) => j.kind === 'video' && !j.background),
    state,
    makers,
    installMaker,
    downloads,
    pauseDownloads,
    resumeDownloads,
    removeMaker,
    createJob,
    saveMedia,
    importItem,
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
                : m?.workflow === 'swap'
                  ? SIZES.swap
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
    markNsfw,
    /** Results set aside for the owner (held.js): never in items(), the Lab or any listing for users. */
    held: {
      list: () => heldStore.list(),
      get: (id) => heldStore.get(id),
      file: (id) => heldStore.file(id),
      note: (id, text) => heldStore.note(id, text),
      approve: (id) => heldStore.approve(id, placeApproved),
    },
    sizes: SIZES,
    mirror,
    /** The first copy of this drive's gallery to R2, while it runs (null otherwise). */
    copyingGallery: () => backfilling,
  };
}
