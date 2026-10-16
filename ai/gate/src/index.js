// Starts the AI machine's gate, keeps the default models downloaded, and turns the machine off
// (stops the Runpod pod) after it has been idle for a while, so it only bills while used.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGate } from './gate.js';
import { createIdleWatch, createModelKeeper, ollamaJson, runpodStopSelf } from './machine.js';
import { installStudioFunction } from './openwebui.js';
import { createStudio } from './studio.js';

const env = process.env;
if (!env.GATEWAY_SECRET || env.GATEWAY_SECRET.length < 32) {
  console.error('GATEWAY_SECRET (32+ characters) is required');
  process.exit(1);
}
const OLLAMA = env.OLLAMA_URL || 'http://127.0.0.1:11434';
const WEBUI = env.WEBUI_URL || 'http://127.0.0.1:8081';
const startedAt = Date.now();

const models = createModelKeeper({
  ollama: OLLAMA,
  wanted: (env.DEFAULT_MODELS || '').split(',').map((s) => s.trim()).filter(Boolean),
});

// Image and video maker (ComfyUI, started by ai/studio.sh). Off when STUDIO_DIR isn't set.
const studio = env.STUDIO_DIR
  ? createStudio({ dir: env.STUDIO_DIR, comfy: env.COMFY_URL || 'http://127.0.0.1:8188', ollama: OLLAMA })
  : null;

const idle = createIdleWatch({
  limitMinutes: Number(env.IDLE_MINUTES || 30),
  // Busy while a model is loaded in GPU memory or a download is running.
  busy: async () => {
    if (models.pulling() || studio?.busy()) return true;
    const ps = await ollamaJson(OLLAMA, '/api/ps').catch(() => null);
    return Boolean(ps?.models?.length);
  },
  stop: () => runpodStopSelf({ podId: env.RUNPOD_POD_ID, apiKey: env.RUNPOD_API_KEY }),
  log: console,
});

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
  return {
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
  studio,
  studioKey: env.STUDIO_KEY || '',
});

server.listen(Number(env.PORT || 8080), '0.0.0.0', () => console.log(`[gate] listening on :${env.PORT || 8080}`));
models.start();
idle.start();

if (studio) {
  studio.start();
  // Put the Image/Video maker models in the playground once Open WebUI is up.
  const codePath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'openwebui', 'studio_pipe.py');
  (async () => {
    for (let i = 0; i < 120; i++) {
      if (await webuiUp()) {
        try {
          await installStudioFunction({ webui: WEBUI, email: env.AI_USER_EMAIL || 'owner@orbit.local', name: env.AI_USER_NAME || 'Owner', codePath });
          return;
        } catch (err) {
          console.warn(`[gate] ${err.message}`);
        }
      }
      await new Promise((r) => setTimeout(r, 10_000));
    }
  })();
}
