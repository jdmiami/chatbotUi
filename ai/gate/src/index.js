// Starts the AI machine's gate, keeps the default models downloaded, and turns the machine off
// (stops the Runpod pod) after it has been idle for a while, so it only bills while used.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGate } from './gate.js';
import { createModelKeeper, ollamaJson } from './machine.js';
import { AUTO_OFF, clampAutoOffMinutes, createAutoOff, runpodStopSelf } from '../../../shared/autooff.js';
import { installStudioFunction } from './openwebui.js';
import { createModelStore } from './store.js';
import { createPush } from './push.js';
import fs from 'node:fs/promises';
import { createStudio } from './studio.js';
import { createMovies, runFfmpeg } from './movies.js';
import { createNsfwCheck } from './nsfwcheck.js';
import { ADULT_NOTE, createMemeLab } from './memes.js';
import { createStyleProfile } from './style.js';
import { createSysStats } from './sysstats.js';
import { createGpuStats } from './gpustats.js';
import { createSearch } from './search.js';
import { createVoice } from './voice.js';
import { createR2, createR2Test, r2FromEnv } from './r2.js';
import { createStorageReport } from './storage.js';
import { createOllamaSync, createWebuiBackup, keptInR2, machineRole } from './cloud.js';
import { FILES, STUDIO_FILES } from './workflows.js';
import { createLiveDraw, createLiveWorker } from './live.js';
import { CANVAS_KREA_GPU_BYTES, TURBO_GPU_BYTES, TURBO_MESSAGE, createLiveEnvs, createLiveServer, createLiveVideo, sageWorks } from './livevideo.js';
import { createCanvas } from './canvas.js';

const env = process.env;
if (!env.GATEWAY_SECRET || env.GATEWAY_SECRET.length < 32) {
  console.error('GATEWAY_SECRET (32+ characters) is required');
  process.exit(1);
}
// helper: a second AI machine that only makes images and videos (no chat, no downloads); it
// shares the main machine's volume, so its creations show up in the same gallery.
// canvas: Live Draw's drawing machine. No chat either, but its own volume: it downloads its own
// makers (CANVAS_MAKERS only, not the built-ins) and its gallery goes to R2 (GALLERY=r2).
const ROLE = machineRole(env);
const HELPER = ROLE === 'helper';
const CANVAS = ROLE === 'canvas';
// No Open WebUI and no Ollama here (ai/setup.sh starts neither).
const NO_CHAT = ROLE !== 'main';
// What the drawing machine keeps, in download order: Live Draw's fast engine (Live draw's SD-Turbo and
// pix2pix-turbo files plus TAESD: small), its Members engine (SD 1.5, LCM-LoRA, ControlNets, IP-Adapter),
// the sketch reader (Florence-2), Sketch finish (Z-Image + ControlNet: Finish), StreamDiffusionV2 (Living
// canvas, and Animate for studio members) and Krea Realtime 14B (the owner's Animate, the biggest). Every
// model file comes through the catalog onto the drive; the workers only read them.
// CANVAS_MAKERS (comma-separated maker ids) replaces the list.
const CANVAS_MAKERS = (env.CANVAS_MAKERS || 'canvas-fast,canvas-licensed,canvas-reader,sketch-finish,live-sdv2,live-krea').split(',').map((s) => s.trim()).filter(Boolean);
// Live Draw's engines (canvas.js): on the drawing machine, and on the main machine with LIVE_CANVAS=1
// (to try it there).
const LIVE_CANVAS = CANVAS || env.LIVE_CANVAS === '1';
// Krea Realtime only has to fit: 40 GB on the drawing machine (H200 141 GB, RTX PRO 6000 96 GB);
// elsewhere the Turbo machine (80 GB) rule stays.
const KREA_BYTES = CANVAS ? CANVAS_KREA_GPU_BYTES : TURBO_GPU_BYTES;
const OLLAMA = env.OLLAMA_URL || 'http://127.0.0.1:11434';
const WEBUI = env.WEBUI_URL || 'http://127.0.0.1:8081';
const startedAt = Date.now();

// No network volume (STORAGE=r2): the disk is wiped at every stop, so chat models, the gallery,
// the maker's files and the playground's chats are kept in Cloudflare R2 (see cloud.js).
const r2conf = r2FromEnv(env);
const kept = keptInR2(env);
const r2 = kept.all && r2conf ? createR2(r2conf) : null;
if (kept.all && !r2) console.warn('[gate] STORAGE=r2 but the R2 keys are missing: nothing will be kept after a stop');
// GALLERY=r2 on a volume: R2 for the gallery only (everything else stays on the volume).
const galleryR2 = r2 || (kept.gallery && r2conf ? createR2(r2conf) : null);
if (kept.gallery && !galleryR2) console.warn('[gate] GALLERY=r2 but the R2 keys are missing: the gallery stays on this machine');
const ollamaSync = r2 && !NO_CHAT && env.OLLAMA_MODELS ? createOllamaSync({ r2, dir: env.OLLAMA_MODELS, log: console }) : null;
const webuiBackup = r2 && !NO_CHAT && env.WEBUI_DIR ? createWebuiBackup({ r2, dir: env.WEBUI_DIR, log: console }) : null;

const models = createModelKeeper({
  ollama: OLLAMA,
  wanted: NO_CHAT ? [] : (env.DEFAULT_MODELS || '').split(',').map((s) => s.trim()).filter(Boolean),
  restore: ollamaSync ? (onProgress) => ollamaSync.restore(onProgress) : null,
  saved: async () => ollamaSync && (await ollamaSync.backup()),
});

// GPU memory of this machine (nvidia-smi), for makers that only fit the Turbo machine.
const gpuStats = createGpuStats({ ollama: OLLAMA, comfy: null });
const gpuMemory = async () => Math.max(0, ...((await gpuStats().catch(() => null))?.gpus || []).map((g) => g.memoryTotal || 0));
// The Python of each Live video maker (ai/live_env.sh), set up once its files are here.
const liveEnvs = env.STUDIO_DIR
  ? createLiveEnvs({ dir: env.STUDIO_DIR, script: fileURLToPath(new URL('../live_env.sh', import.meta.url)), node: process.execPath, log: console })
  : null;
// Image and video maker (ComfyUI, started by ai/studio.sh). Off when STUDIO_DIR isn't set.
const studio = env.STUDIO_DIR
  ? createStudio({
      dir: env.STUDIO_DIR,
      comfy: env.COMFY_URL || 'http://127.0.0.1:8188',
      ollama: OLLAMA,
      helper: HELPER,
      role: ROLE,
      r2,
      gallery: galleryR2,
      makers: CANVAS ? CANVAS_MAKERS : null,
      inUseElsewhere: (id) => movies?.usedElsewhere(id),
      // A video needs the whole graphics card: Live draw lets go of it first.
      makeWayForVideo: async () => {
        liveDraw?.release();
        liveVideo?.release();
        // The main machine's card is shared; the drawing machine's has room for both.
        if (!CANVAS) canvas?.release();
      },
      liveEnvs,
      gpuMemory,
      turboBytes: KREA_BYTES,
      turboMessage: TURBO_MESSAGE,
      // Gated downloads (LTX-2.5). A Runpod secret that was never set arrives as "{{ RUNPOD_SECRET_… }}".
      hfToken: /^\{\{/.test(env.HF_TOKEN || '') ? '' : env.HF_TOKEN || env.HUGGING_FACE_HUB_TOKEN || '',
      // Looks at every picture and video for NSFW, on the CPU (nsfwcheck.js).
      nsfw: createNsfwCheck({
        python: path.join(env.STUDIO_DIR, 'venv', 'bin', 'python'),
        script: fileURLToPath(new URL('../nsfw_worker.py', import.meta.url)),
        env: { HF_HOME: path.join(env.STUDIO_DIR, 'hf') },
        ffmpeg: (args) => runFfmpeg(args, { timeoutMs: 60_000 }),
      }),
    })
  : null;
// Live draw (live.js): pix2pix-turbo answers each stroke in its own worker on the graphics card,
// started when Live draw is used and unloaded after a few quiet minutes.
const liveDraw = studio
  ? createLiveDraw({
      worker: createLiveWorker({
        name: 'Live draw',
        python: path.join(env.STUDIO_DIR, 'venv', 'bin', 'python'),
        script: fileURLToPath(new URL('../live_draw_worker.py', import.meta.url)),
        env: {
          LIVE_DRAW_SD_TURBO: path.join(env.STUDIO_DIR, 'models', 'live', 'sd-turbo'),
          LIVE_DRAW_LORA: studio.modelPath(FILES.pix2pixSketchLora),
          HF_HOME: path.join(env.STUDIO_DIR, 'hf'),
        },
        idleMs: 4 * 60_000,
        log: console,
      }),
      installed: () => studio.makerInstalled('live-draw'),
      makeRoom: () => studio.makeRoom(),
      paused: () => (studio.videoInFlight() ? 'Your AI machine is making a video: live previews wait until it is done.' : null),
      activity: () => idle.activity(),
    })
  : null;
// Live video (livevideo.js): StreamDiffusionV2 in its own worker, Krea Realtime as Krea's own server
// on 127.0.0.1 (never exposed: Orbit reaches both through the gate's /_orbit/live/video).
const KREA_PORT = Number(env.KREA_PORT || 8766);
const KREA_PYTHON = liveEnvs ? path.join(liveEnvs.root, 'krea', 'src', '.venv', 'bin', 'python') : null;
const kreaEnv = {
  MODEL_FOLDER: path.join(env.STUDIO_DIR || '', 'models', 'live', 'wan_models'),
  CONFIG: 'configs/self_forcing_server_14b.yaml',
  // torch.compile makes the first start much slower; not worth it for a session or two.
  DO_COMPILE: 'false',
  CUDA_VISIBLE_DEVICES: '0',
  HF_HOME: path.join(env.STUDIO_DIR || '', 'hf'),
};
let sageChecked = null;
const liveVideo =
  studio && liveEnvs
    ? createLiveVideo({
        studio,
        envs: liveEnvs,
        sdv2Worker: () =>
          createLiveWorker({
            name: 'StreamDiffusionV2',
            python: path.join(liveEnvs.root, 'sdv2', 'src', '.venv', 'bin', 'python'),
            script: fileURLToPath(new URL('../live_video_worker.py', import.meta.url)),
            env: {
              SDV2_REPO: path.join(liveEnvs.root, 'sdv2', 'src'),
              SDV2_CKPT: path.dirname(studio.modelPath(FILES.sdv2Ckpt)),
              STREAMDIFFUSIONV2_ROOT: path.join(env.STUDIO_DIR, 'models', 'live'),
              HF_HOME: path.join(env.STUDIO_DIR, 'hf'),
              HF_HUB_OFFLINE: '1',
            },
            idleMs: 4 * 60_000,
            startTimeoutMs: 15 * 60_000,
            timeoutMs: 120_000,
            log: console,
          }),
        krea: createLiveServer({
          name: 'Krea Realtime',
          cmd: KREA_PYTHON,
          args: ['-m', 'uvicorn', 'release_server:app', '--host', '127.0.0.1', '--port', String(KREA_PORT)],
          cwd: path.join(liveEnvs.root, 'krea', 'src'),
          env: kreaEnv,
          url: `http://127.0.0.1:${KREA_PORT}`,
          // Its config reads checkpoints/krea-realtime-video-14b.safetensors from its own folder.
          prepare: async () => {
            const link = path.join(liveEnvs.root, 'krea', 'src', 'checkpoints', FILES.kreaRealtime.name);
            await fs.mkdir(path.dirname(link), { recursive: true });
            await fs.rm(link, { force: true });
            await fs.symlink(studio.modelPath(FILES.kreaRealtime), link);
            // Its SageAttention wheel is built for Hopper (H100/H200): tried once on this card; on
            // another (the RTX PRO 6000 Blackwell) Krea falls back to PyTorch's own attention.
            if (sageChecked === null) {
              sageChecked = await sageWorks({ python: KREA_PYTHON });
              if (!sageChecked) kreaEnv.DISABLE_SAGEATTENTION = '1';
              console.log(`[live] Krea Realtime attention: ${sageChecked ? 'SageAttention' : 'PyTorch SDPA (SageAttention has no kernel for this card)'}`);
            }
          },
          idleMs: 5 * 60_000,
          log: console,
        }),
        kreaUrl: `ws://127.0.0.1:${KREA_PORT}`,
        gpuMemory,
        turboBytes: KREA_BYTES,
        makeWay: async () => liveDraw?.release(),
        activity: () => idle.activity(),
        ffmpeg: (args, opts) => runFfmpeg(args, opts),
        log: console,
      })
    : null;
// Live Draw (canvas.js, canvas_worker.py): both engine sets and the sketch reader in one worker on the
// graphics card. On the drawing machine it keeps them for 20 quiet minutes (the card is its own); on
// the main machine it hands the card back sooner and waits while a video is made.
const canvas =
  studio && LIVE_CANVAS
    ? createCanvas({
        makeWorker: (onEvent) =>
          createLiveWorker({
            name: 'Live Draw engines',
            python: path.join(env.STUDIO_DIR, 'venv', 'bin', 'python'),
            script: fileURLToPath(new URL('../canvas_worker.py', import.meta.url)),
            // Reads only the catalog's files under the studio's models folder (the drive); never downloads.
            env: {
              STUDIO_DIR: env.STUDIO_DIR,
              CANVAS_MODELS: path.join(env.STUDIO_DIR, 'models'),
              CANVAS_SD_TURBO: path.dirname(path.dirname(studio.modelPath(FILES.sdTurboUnet))),
              CANVAS_P2P_LORA: studio.modelPath(FILES.pix2pixSketchLora),
              HF_HUB_OFFLINE: '1',
            },
            idleMs: (CANVAS ? 20 : 5) * 60_000,
            startTimeoutMs: 5 * 60_000,
            timeoutMs: 60_000,
            onEvent,
            log: console,
          }),
        studio,
        makeRoom: CANVAS ? null : () => studio.makeRoom(),
        paused: CANVAS ? null : () => (studio.videoInFlight() ? 'Your AI machine is making a video: Live Draw waits until it is done.' : null),
        activity: () => idle.activity(),
        gpu: async () => {
          const g = (await gpuStats().catch(() => null))?.gpus?.[0];
          return g ? { name: g.name, memoryGb: Math.round((g.memoryTotal || 0) / 2 ** 30) } : null;
        },
        log: console,
      })
    : null;
// soReal movies (chained video shots), kept with the studio's files.
// A chat model on this machine writes each movie's story (labChat: below, the same as the meme lab's).
const movies = studio ? createMovies({ dir: env.STUDIO_DIR, studio, machine: ROLE, mirror: studio.mirror, chat: ({ system, user }) => labChat({ system, user }) }) : null;
// R2 speed test (only when the R2 keys are set as Runpod secrets): the Qwen image model, volume vs R2.
const QWEN = STUDIO_FILES.image[0];
const r2test = studio && r2conf && !r2
  ? createR2Test({ r2: createR2(r2conf), file: path.join(env.STUDIO_DIR, 'models', QWEN.dir, QWEN.name), key: `models/${QWEN.dir}/${QWEN.name}` })
  : null;

// Models added from the Model store (their downloads count as a job, like the default models').
const store = createModelStore({
  ollama: OLLAMA,
  volume: env.PERSIST_DIR || '/workspace',
  saved: async () => ollamaSync && (await ollamaSync.backup()),
  removed: async () => ollamaSync && (await ollamaSync.prune().catch((err) => console.warn(`[gate] could not remove it from R2: ${err.message}`))),
});

// Notifications to the owner's phone/computer. The list of browsers is kept in R2 when the disk
// is wiped at each stop, otherwise next to the models.
const PUSH_KEY = 'orbit/push-subscriptions.json';
const pushFile = path.join(env.PERSIST_DIR || '/workspace', '.orbit-push.json');
const push = NO_CHAT
  ? null
  : createPush({
      secret: env.GATEWAY_SECRET,
      subject: /^https:\/\//.test(env.SITE_URL || '') ? env.SITE_URL.replace(/\/$/, '') : 'mailto:owner@orbit.local',
      load: async () => (r2 ? r2.getJson(PUSH_KEY) : JSON.parse(await fs.readFile(pushFile, 'utf8'))),
      save: async (list) => (r2 ? r2.put(PUSH_KEY, JSON.stringify(list), 'application/json') : fs.writeFile(pushFile, JSON.stringify(list))),
      log: console,
    });

// The one auto-off rule (shared/autooff.js): off after IDLE_MINUTES without a job. The site sends its
// AUTO_OFF_MINUTES as IDLE_MINUTES; never more than an hour and never 0 (the money fail-safe). The
// meme lab fills that time with videos, but its videos never count as a job.
const idle = createAutoOff({
  limitMinutes: clampAutoOffMinutes(env.IDLE_MINUTES),
  // Busy while a picture, video or movie shot is being made or a download is running (so the hour
  // starts once every download is done). A model merely sitting in GPU memory is not a job.
  busy: async () => Boolean(models.pulling() || store.busy() || studio?.busy() || liveDraw?.busy() || liveVideo?.busy() || canvas?.busy() || r2test?.running() || ollamaSync?.busy() || webuiBackup?.busy()),
  // A notification shortly before turning off, so the owner can keep it on.
  warnMinutes: AUTO_OFF.warnMinutes,
  warn: push ? async () => void (await push.send()) : null,
  stop: async () => {
    // Last chats first: the disk is wiped when the machine stops.
    if (webuiBackup) await webuiBackup.snapshot().catch((err) => console.warn(`[gate] could not save the playground: ${err.message}`));
    await runpodStopSelf({ podId: env.RUNPOD_POD_ID, apiKey: env.RUNPOD_API_KEY });
  },
  log: console,
  tag: '[gate]',
});

// The meme lab (memes.js): makes 30-second meme movies while nobody is using the machine, and has a chat
// model on this machine score how viral each could go. Only on the main machine.
const LAB_KEY = 'state/meme-lab.json';
const labFile = path.join(env.PERSIST_DIR || '/workspace', '.orbit-meme-lab.json');
async function labChatModel() {
  const tags = await ollamaJson(OLLAMA, '/api/tags').catch(() => null);
  const names = (tags?.models || []).map((m) => m.name);
  if (env.MEME_MODEL && names.includes(env.MEME_MODEL)) return { name: env.MEME_MODEL, vision: /gemma|vl|llava|vision|pixtral|minicpm/i.test(env.MEME_MODEL) };
  const vision = names.find((n) => /gemma3|gemma4|qwen2\.5vl|qwen3-vl|llava|vision|minicpm-v|pixtral/i.test(n));
  if (vision) return { name: vision, vision: true };
  const small = names.find((n) => !/embed/i.test(n));
  return small ? { name: small, vision: false } : null;
}
async function labChat({ system, user, images, temperature = 0.9 }) {
  const m = await labChatModel();
  if (!m) throw new Error('No chat model is installed on the AI machine.');
  const ask = async (withImages) => {
    const res = await fetch(`${OLLAMA}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: m.name,
        stream: false,
        options: { temperature },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user, ...(withImages && images?.length ? { images } : {}) },
        ],
      }),
      signal: AbortSignal.timeout(180_000),
    });
    if (!res.ok) throw new Error(`chat model: ${res.status}`);
    return (await res.json())?.message?.content || '';
  };
  // A model that can't see answers from the idea alone.
  return m.vision ? ask(true).catch(() => ask(false)) : ask(false);
}
// "Your style" (style.js): a profile of the owner's own saved prompts, written by the same chat model
// on this machine (nothing leaves it), that the Lab's "Your style" movies are made from.
const STYLE_KEY = 'state/your-style.json';
const styleFile = path.join(env.PERSIST_DIR || '/workspace', '.orbit-your-style.json');
const yourStyle =
  studio && movies && !NO_CHAT
    ? createStyleProfile({
        sources: async () => ({
          items: (await studio.items(1000)).map((it) => ({ ...it, prompt: String(it.prompt || '').replace(ADULT_NOTE, '') })),
          movies: await movies.list(),
          labIdeas: lab ? await lab.ownIdeas() : [],
        }),
        // Steadier than the idea writer: it sums up, it doesn't invent.
        chat: ({ system, user }) => labChat({ system, user, temperature: 0.3 }),
        load: async () => (r2 ? r2.getJson(STYLE_KEY) : JSON.parse(await fs.readFile(styleFile, 'utf8'))),
        save: async (state) => (r2 ? r2.put(STYLE_KEY, JSON.stringify(state), 'application/json') : fs.writeFile(styleFile, JSON.stringify(state))),
        log: console,
      })
    : null;
const lab =
  studio && !NO_CHAT
    ? createMemeLab({
        studio,
        // Every Lab style makes 30-second movies through soReal's auto flow (chained from each last
        // frame); "Your style" writes them from the profile above.
        movies,
        profile: yourStyle,
        quietSeconds: () => idle.state().idleSeconds,
        // The lab plans enough videos to fill the time until the machine turns itself off.
        minutesLeft: () => {
          const off = Date.parse(idle.state().offAt || '');
          return Number.isFinite(off) ? Math.max(0, (off - Date.now()) / 60_000) : idle.state().limitMinutes;
        },
        chat: labChat,
        load: async () => (r2 ? r2.getJson(LAB_KEY) : JSON.parse(await fs.readFile(labFile, 'utf8'))),
        save: async (state) => (r2 ? r2.put(LAB_KEY, JSON.stringify(state), 'application/json') : fs.writeFile(labFile, JSON.stringify(state))),
        log: console,
      })
    : null;

const sys = createSysStats({ volume: env.PERSIST_DIR || '/workspace' });
const gpu = createGpuStats({ ollama: OLLAMA, comfy: studio ? env.COMFY_URL || 'http://127.0.0.1:8188' : null });
const storage = createStorageReport({
  r2: galleryR2,
  items: async () => (studio ? [...(await studio.items(10_000)), ...(await studio.labItems(10_000))] : []),
  disks: () => sys.disks(),
});
async function stats() {
  const [system, graphics] = await Promise.all([sys.collect(), gpu()]);
  return { ...system, ...graphics, idle: idle.state(), uptimeMinutes: Math.round((Date.now() - startedAt) / 60000) };
}

async function webuiUp() {
  try {
    const res = await fetch(`${WEBUI}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function status() {
  const [tags, ps, ui, studioState] = await Promise.all([
    ollamaJson(OLLAMA, '/api/tags').catch(() => null),
    ollamaJson(OLLAMA, '/api/ps').catch(() => null),
    webuiUp(),
    studio ? studio.state().catch(() => null) : null,
  ]);
  if (NO_CHAT) {
    // Ready once the maker runs; there is no chat here.
    return {
      role: ROLE,
      ready: Boolean(studioState?.running),
      webui: false,
      ollama: false,
      models: [],
      loaded: [],
      pulling: null,
      defaultModels: [],
      uptimeMinutes: Math.round((Date.now() - startedAt) / 60000),
      idle: idle.state(),
      canStopSelf: Boolean(env.RUNPOD_POD_ID && env.RUNPOD_API_KEY),
      studio: studioState,
      // Live Draw's engines: off | loading | ready | error each (the site shows "warming up").
      ...(canvas ? { canvas: canvas.engines() } : {}),
    };
  }
  return {
    role: 'main',
    ready: Boolean(ui && tags),
    webui: ui,
    ollama: Boolean(tags),
    models: (tags?.models || []).map((m) => ({ name: m.name, size: m.size })),
    loaded: (ps?.models || []).map((m) => m.name),
    pulling: models.progress(),
    defaultModels: models.wanted,
    uptimeMinutes: Math.round((Date.now() - startedAt) / 60000),
    idle: idle.state(),
    // Runpod gives each pod a key scoped to itself; without it the machine can't turn itself off.
    canStopSelf: Boolean(env.RUNPOD_POD_ID && env.RUNPOD_API_KEY),
    studio: studioState,
    ...(canvas ? { canvas: canvas.engines() } : {}),
  };
}

const server = createGate({
  secret: env.GATEWAY_SECRET,
  webui: WEBUI,
  ollama: OLLAMA,
  allowedOrigins: env.ALLOWED_ORIGINS || '',
  siteUrl: (env.SITE_URL || '').replace(/\/$/, ''),
  userEmail: env.AI_USER_EMAIL || 'owner@orbit.local',
  userName: env.AI_USER_NAME || 'Owner',
  trustedEmailHeader: 'X-Orbit-Email',
  trustedNameHeader: 'X-Orbit-Name',
  activity: () => idle.activity(),
  status,
  stats,
  storage,
  keepAwake: (minutes) => idle.extend(minutes),
  // The same shape as the Linux machine's /idle, plus which AI machine this is.
  idleState: () => ({ ...idle.state(), role: ROLE, uptimeMinutes: Math.round((Date.now() - startedAt) / 60000) }),
  studio,
  movies,
  lab,
  liveDraw,
  liveVideo,
  canvas,
  r2test,
  studioKey: env.STUDIO_KEY || '',
  store,
  push,
  search: createSearch(),
  voice: createVoice({ webui: WEBUI, email: env.AI_USER_EMAIL || 'owner@orbit.local', name: env.AI_USER_NAME || 'Owner' }),
});

server.listen(Number(env.PORT || 8080), '0.0.0.0', () => console.log(`[gate] listening on :${env.PORT || 8080}`));
if (!NO_CHAT) models.start();
idle.start();
webuiBackup?.start();

if (studio) studio.start();
lab?.start();
if (studio && !NO_CHAT) {
  // Put the Image/Video maker models in the playground once Open WebUI is up.
  const codePath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'openwebui', 'studio_pipe.py');
  (async () => {
    for (let i = 0; i < 120; i++) {
      if (await webuiUp()) {
        try {
          await installStudioFunction({
            webui: WEBUI,
            email: env.AI_USER_EMAIL || 'owner@orbit.local',
            name: env.AI_USER_NAME || 'Owner',
            codePath,
            studioKey: env.STUDIO_KEY,
          });
          return;
        } catch (err) {
          console.warn(`[gate] ${err.message}`);
        }
      }
      await new Promise((r) => setTimeout(r, 10_000));
    }
  })();
}
