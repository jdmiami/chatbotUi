// Starts the AI machine's gate, keeps the default models downloaded, and turns the machine off
// (stops the Runpod pod) after it has been idle for a while, so it only bills while used.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGate } from './gate.js';
import { createIdleWatch, createModelKeeper, ollamaJson, runpodStopSelf } from './machine.js';
import { installStudioFunction } from './openwebui.js';
import { createModelStore } from './store.js';
import { createPush } from './push.js';
import fs from 'node:fs/promises';
import { createStudio } from './studio.js';
import { createMovies } from './movies.js';
import { createMemeLab } from './memes.js';
import { createSysStats } from './sysstats.js';
import { createGpuStats } from './gpustats.js';
import { createSearch } from './search.js';
import { createVoice } from './voice.js';
import { createR2, createR2Test, r2FromEnv } from './r2.js';
import { createOllamaSync, createWebuiBackup } from './cloud.js';
import { STUDIO_FILES } from './workflows.js';

const env = process.env;
if (!env.GATEWAY_SECRET || env.GATEWAY_SECRET.length < 32) {
  console.error('GATEWAY_SECRET (32+ characters) is required');
  process.exit(1);
}
// helper: a second AI machine that only makes images and videos (no chat, no downloads); it
// shares the main machine's volume, so its creations show up in the same gallery.
const HELPER = env.AI_ROLE === 'helper';
const OLLAMA = env.OLLAMA_URL || 'http://127.0.0.1:11434';
const WEBUI = env.WEBUI_URL || 'http://127.0.0.1:8081';
const startedAt = Date.now();

// No network volume (STORAGE=r2): the disk is wiped at every stop, so chat models, the gallery,
// the maker's files and the playground's chats are kept in Cloudflare R2 (see cloud.js).
const r2conf = r2FromEnv(env);
const r2 = env.STORAGE === 'r2' && r2conf ? createR2(r2conf) : null;
if (env.STORAGE === 'r2' && !r2) console.warn('[gate] STORAGE=r2 but the R2 keys are missing: nothing will be kept after a stop');
const ollamaSync = r2 && !HELPER && env.OLLAMA_MODELS ? createOllamaSync({ r2, dir: env.OLLAMA_MODELS, log: console }) : null;
const webuiBackup = r2 && !HELPER && env.WEBUI_DIR ? createWebuiBackup({ r2, dir: env.WEBUI_DIR, log: console }) : null;

const models = createModelKeeper({
  ollama: OLLAMA,
  wanted: HELPER ? [] : (env.DEFAULT_MODELS || '').split(',').map((s) => s.trim()).filter(Boolean),
  restore: ollamaSync ? (onProgress) => ollamaSync.restore(onProgress) : null,
  saved: async () => ollamaSync && (await ollamaSync.backup()),
});

// Image and video maker (ComfyUI, started by ai/studio.sh). Off when STUDIO_DIR isn't set.
const studio = env.STUDIO_DIR
  ? createStudio({ dir: env.STUDIO_DIR, comfy: env.COMFY_URL || 'http://127.0.0.1:8188', ollama: OLLAMA, helper: HELPER, r2, inUseElsewhere: (id) => movies?.usedElsewhere(id) })
  : null;
// soReal movies (chained video shots), kept with the studio's files.
const movies = studio ? createMovies({ dir: env.STUDIO_DIR, studio, machine: HELPER ? 'helper' : 'main', mirror: studio.mirror }) : null;
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
const push = HELPER
  ? null
  : createPush({
      secret: env.GATEWAY_SECRET,
      subject: /^https:\/\//.test(env.SITE_URL || '') ? env.SITE_URL.replace(/\/$/, '') : 'mailto:owner@orbit.local',
      load: async () => (r2 ? r2.getJson(PUSH_KEY) : JSON.parse(await fs.readFile(pushFile, 'utf8'))),
      save: async (list) => (r2 ? r2.put(PUSH_KEY, JSON.stringify(list), 'application/json') : fs.writeFile(pushFile, JSON.stringify(list))),
      log: console,
    });

// Turns itself off after an hour without a job (IDLE_MINUTES can only make that shorter). The meme
// lab fills that hour with videos, but its videos never count as a job.
const idle = createIdleWatch({
  limitMinutes: Math.min(Number(env.IDLE_MINUTES) || 60, 60),
  // Busy while a picture, video or movie shot is being made or a download is running (so the hour
  // starts once every download is done). A model merely sitting in GPU memory is not a job.
  busy: async () => Boolean(models.pulling() || store.busy() || studio?.busy() || r2test?.running() || ollamaSync?.busy() || webuiBackup?.busy()),
  // 10 minutes before turning off: a notification, so the owner can keep it on.
  warnMinutes: 10,
  warn: push ? async () => void (await push.send()) : null,
  stop: async () => {
    // Last chats first: the disk is wiped when the machine stops.
    if (webuiBackup) await webuiBackup.snapshot().catch((err) => console.warn(`[gate] could not save the playground: ${err.message}`));
    await runpodStopSelf({ podId: env.RUNPOD_POD_ID, apiKey: env.RUNPOD_API_KEY });
  },
  log: console,
});

// The meme lab (memes.js): makes meme videos while nobody is using the machine, and has a chat
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
async function labChat({ system, user, images }) {
  const m = await labChatModel();
  if (!m) throw new Error('No chat model is installed on the AI machine.');
  const ask = async (withImages) => {
    const res = await fetch(`${OLLAMA}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: m.name,
        stream: false,
        options: { temperature: 0.9 },
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
const lab =
  studio && !HELPER
    ? createMemeLab({
        studio,
        quietSeconds: () => idle.state().idleSeconds,
        chat: labChat,
        load: async () => (r2 ? r2.getJson(LAB_KEY) : JSON.parse(await fs.readFile(labFile, 'utf8'))),
        save: async (state) => (r2 ? r2.put(LAB_KEY, JSON.stringify(state), 'application/json') : fs.writeFile(labFile, JSON.stringify(state))),
        log: console,
      })
    : null;

const sys = createSysStats({ volume: env.PERSIST_DIR || '/workspace' });
const gpu = createGpuStats({ ollama: OLLAMA, comfy: studio ? env.COMFY_URL || 'http://127.0.0.1:8188' : null });
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
  if (HELPER) {
    // Ready once the maker runs; there is no chat here.
    return {
      role: 'helper',
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
  activity: () => idle.touch(),
  status,
  stats,
  keepAwake: (minutes) => idle.extend(minutes),
  idleState: () => {
    const s = idle.state();
    return { role: HELPER ? 'helper' : 'main', limitMinutes: s.limitMinutes, idleMinutes: s.idleMinutes, offAt: s.offAt, heldUntil: s.heldUntil, uptimeMinutes: Math.round((Date.now() - startedAt) / 60000) };
  },
  studio,
  movies,
  lab,
  r2test,
  studioKey: env.STUDIO_KEY || '',
  store,
  push,
  search: createSearch(),
  voice: createVoice({ webui: WEBUI, email: env.AI_USER_EMAIL || 'owner@orbit.local', name: env.AI_USER_NAME || 'Owner' }),
});

server.listen(Number(env.PORT || 8080), '0.0.0.0', () => console.log(`[gate] listening on :${env.PORT || 8080}`));
if (!HELPER) models.start();
idle.start();
webuiBackup?.start();

if (studio) studio.start();
lab?.start();
if (studio && !HELPER) {
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
