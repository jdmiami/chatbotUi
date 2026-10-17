// Image and video maker ("studio") for the AI machine: downloads the model files, runs jobs on the
// local ComfyUI (127.0.0.1:8188, never exposed), tracks their progress, keeps a gallery on the
// network volume and serves the results. Everything that creates something goes through
// createJob(), which applies the one content rule (no sexual content involving minors).
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { STUDIO_FILES, imageWorkflow, videoWorkflow } from './workflows.js';

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

// ---------------------------------------------------------------- helpers

const SIZES = {
  image: { square: [1328, 1328], portrait: [1104, 1472], landscape: [1472, 1104], wide: [1664, 928], tall: [928, 1664] },
  video: { landscape: [1280, 720], portrait: [720, 1280], square: [960, 960] },
};
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.webm': 'video/webm' };
const newId = () => crypto.randomBytes(9).toString('base64url');

function sniffImage(buf) {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return '.png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return '.jpg';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return '.webp';
  return null;
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

  const jobs = new Map(); // id -> job
  const byPrompt = new Map(); // ComfyUI prompt_id -> job
  const download = { current: null, done: new Set(), error: null, running: false };
  let lastJobEnd = 0;
  let comfyHoldsGpu = false;
  let ws = null;

  const modelPath = (file) => path.join(dir, 'models', file.dir, file.name);
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
      for (const kind of ['image', 'video']) {
        for (const file of files[kind]) {
          for (let attempt = 0; !(await haveFile(file)); attempt++) {
            try {
              await fetchFile(file);
              download.error = null;
            } catch (err) {
              download.error = err.message;
              log.warn?.(`[studio] ${err.message}; retrying in 30s`);
              await new Promise((r) => setTimeout(r, o.retryMs ?? 30_000));
            }
          }
          download.done.add(file.name);
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
      throw new Error(`ComfyUI ${p}: ${res.status} ${detail}`);
    }
    return body;
  }
  const comfyUp = () => comfyJson('/system_stats', { timeout: 3000 }).then(() => true, () => false);

  async function setupState() {
    return (await fsp.readFile(path.join(dir, 'state'), 'utf8').catch(() => 'installing')).trim();
  }

  function connectWs() {
    if (!WS || ws) return;
    try {
      ws = new WS(`${comfy.replace(/^http/, 'ws')}/ws?clientId=${clientId}`);
    } catch {
      ws = null;
      return;
    }
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
      if (msg.type === 'execution_start' || msg.type === 'executing') job.status = 'running';
      if (msg.type === 'progress') onProgress(job, String(msg.data.node), msg.data.value, msg.data.max);
      if (msg.type === 'execution_error') void finish(job, msg.data.exception_message || 'The job failed.');
      if (msg.type === 'execution_success') void finish(job);
      if (msg.type === 'execution_interrupted') void finish(job, 'Stopped.');
    };
    const drop = () => {
      ws = null;
    };
    ws.onclose = drop;
    ws.onerror = drop;
  }

  // How far along a job is: each sampling pass covers part of the bar.
  const STAGES = { image: { 7: [0, 95] }, video: { 38: [5, 70], 47: [70, 92] } };
  function onProgress(job, node, value, max) {
    const stage = STAGES[job.kind][node];
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
  const active = () => [...jobs.values()].filter((j) => j.status === 'queued' || j.status === 'running');

  function publicJob(j) {
    return {
      id: j.id,
      kind: j.kind,
      prompt: j.prompt,
      status: j.status,
      progress: j.progress,
      error: j.error || null,
      createdAt: j.createdAt,
      finishedAt: j.finishedAt || null,
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
   * Start a job. req: { kind: 'image'|'video', prompt, size?, seconds?, image? (data URL), fromItem? (gallery id) }.
   * Throws errors with .status for bad requests.
   */
  async function createJob(req) {
    const kind = req.kind === 'video' ? 'video' : 'image';
    const prompt = String(req.prompt || '').trim().slice(0, 4000);
    if (!prompt) throw Object.assign(new Error('Describe what to make.'), { status: 400 });
    if (blockedPrompt(prompt)) throw Object.assign(new Error(BLOCKED_MESSAGE), { status: 422, blocked: true });
    if (!(await ready(kind))) {
      throw Object.assign(new Error(`The ${kind} maker is still downloading (${kindProgress(kind)}%). Try again when it's done.`), { status: 503 });
    }
    if (!(await comfyUp())) throw Object.assign(new Error('The image and video maker is still starting. Try again in a minute.'), { status: 503 });

    const sizes = SIZES[kind];
    const [width, height] = sizes[req.size] || Object.values(sizes)[0];
    const seconds = kind === 'video' ? Math.min(10, Math.max(2, Math.round(Number(req.seconds) || 5))) : undefined;
    const id = newId();
    const image = kind !== 'video' ? null : req.fromItem ? await copyFromGallery(String(req.fromItem)) : req.image ? await saveUpload(req.image) : null;
    const prefix = `orbit/${kind}-${id}`;
    const workflow = kind === 'video' ? videoWorkflow({ prompt, width, height, seconds, image, prefix }) : imageWorkflow({ prompt, width, height, prefix });

    const job = { id, kind, prompt, width, height, seconds, fromImage: Boolean(image), status: 'queued', progress: 0, createdAt: new Date(now()).toISOString() };
    jobs.set(id, job);
    try {
      connectWs();
      await unloadChatModels();
      const r = await comfyJson('/prompt', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: workflow, client_id: clientId }),
      });
      job.promptId = r.prompt_id;
      byPrompt.set(r.prompt_id, job);
      comfyHoldsGpu = true;
    } catch (err) {
      job.status = 'error';
      job.error = err.message;
    }
    return publicJob(job);
  }

  async function finish(job, error) {
    if (job.status === 'done' || job.status === 'error' || job.status === 'stopped') return;
    lastJobEnd = now();
    if (error) {
      job.status = error === 'Stopped.' ? 'stopped' : 'error';
      job.error = error;
      job.finishedAt = new Date(now()).toISOString();
      return;
    }
    try {
      const hist = await comfyJson(`/history/${encodeURIComponent(job.promptId)}`);
      const out = outputFiles(hist[job.promptId]?.outputs)[0];
      if (!out) throw new Error('The job finished without a result.');
      const file = path.posix.join(out.subfolder || '', out.filename);
      const item = {
        id: job.id,
        kind: job.kind,
        prompt: job.prompt,
        width: job.width,
        height: job.height,
        seconds: job.seconds,
        fromImage: job.fromImage,
        file,
        createdAt: job.createdAt,
      };
      await fsp.mkdir(metaDir, { recursive: true });
      await fsp.writeFile(path.join(metaDir, `${job.id}.json`), JSON.stringify(item));
      job.item = item;
      job.progress = 100;
      job.status = 'done';
    } catch (err) {
      job.status = 'error';
      job.error = err.message;
    }
    job.finishedAt = new Date(now()).toISOString();
  }

  // Fallback for missed WebSocket messages: ask ComfyUI directly.
  async function poll() {
    for (const job of active()) {
      if (!job.promptId) continue;
      const hist = await comfyJson(`/history/${encodeURIComponent(job.promptId)}`).catch(() => null);
      const h = hist?.[job.promptId];
      if (!h) continue;
      const st = h.status || {};
      if (st.completed || st.status_str === 'success') await finish(job);
      else if (st.status_str === 'error') {
        const msg = (st.messages || []).find((m) => m[0] === 'execution_error')?.[1]?.exception_message;
        await finish(job, msg || 'The job failed.');
      }
    }
    // Forget finished jobs after an hour (the gallery keeps the results).
    for (const [id, j] of jobs) if (j.finishedAt && now() - Date.parse(j.finishedAt) > 3600_000) jobs.delete(id);
    await releaseGpu();
  }

  async function cancel(id) {
    const job = jobs.get(id);
    if (!job) return null;
    if (job.promptId && (job.status === 'queued' || job.status === 'running')) {
      await comfyJson('/queue', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ delete: [job.promptId] }) }).catch(() => {});
      if (job.status === 'running') await comfyJson('/interrupt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt_id: job.promptId }) }).catch(() => {});
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
      void downloadAll();
      const t = setInterval(() => void poll().catch(() => {}), o.pollMs ?? 3000);
      t.unref?.();
    },
    busy: () => download.running || active().length > 0,
    /** A chat needs the GPU: hand it back from ComfyUI now if nothing is being made. */
    async yieldGpu() {
      if (!comfyHoldsGpu || active().length) return;
      comfyHoldsGpu = false;
      await comfyJson('/free', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ unload_models: true, free_memory: true }) }).catch(
        () => {},
      );
    },
    state,
    createJob,
    job: (id) => (jobs.has(id) ? publicJob(jobs.get(id)) : null),
    cancel,
    items,
    item: readItem,
    remove,
    file,
    poll,
    sizes: SIZES,
  };
}
