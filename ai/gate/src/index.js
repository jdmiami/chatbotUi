// Starts the AI machine's gate, keeps the default models downloaded, and turns the machine off
// (stops the Runpod pod) after it has been idle for a while, so it only bills while used.
import { createGate } from './gate.js';
import { createIdleWatch, createModelKeeper, ollamaJson, runpodStopSelf } from './machine.js';

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

const idle = createIdleWatch({
  limitMinutes: Number(env.IDLE_MINUTES || 30),
  // Busy while a model is loaded in GPU memory or a download is running.
  busy: async () => {
    if (models.pulling()) return true;
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
  const [tags, ps, ui] = await Promise.all([
    ollamaJson(OLLAMA, '/api/tags').catch(() => null),
    ollamaJson(OLLAMA, '/api/ps').catch(() => null),
    webuiUp(),
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
});

server.listen(Number(env.PORT || 8080), '0.0.0.0', () => console.log(`[gate] listening on :${env.PORT || 8080}`));
models.start();
idle.start();
