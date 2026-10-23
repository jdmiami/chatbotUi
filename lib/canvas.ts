import 'server-only';
import { runpod } from './runpod';
import { autoOffMinutes } from './autoOff';
import {
  aiBase,
  aiToken,
  allowedOrigins,
  env as aiEnv,
  findPodNamed,
  hfTokenEnv,
  NA_DATA_CENTERS,
  idleOf,
  noCapacity,
  r2SecretEnv,
  repoRaw,
  siteUrl,
  type AiIdle,
  type GateStatus,
  type Pod,
} from './ai';

/**
 * The drawing machine (Live Draw, docs/livedraw/DESIGN.md §3): its own GPU pod, on only while used,
 * with the same image, setup (ai/setup.sh with AI_ROLE=canvas) and sign-in as the AI machine.
 *
 * It keeps its model files and its packed software on a Runpod global volume (CANVAS_GLOBAL_VOLUME_ID,
 * mounted at /workspace-global, STORAGE=global), so a start never downloads anything twice. A global
 * volume belongs to no data centre, so the pod starts wherever a GPU is free: the H200 first (Bring to
 * life runs Krea Realtime 14B, which needs H100-class compute to stay ahead of playback), then the
 * RTX PRO 6000 (live drawing is just as fast on it; Krea runs slower). It stays in North America
 * (live drawing is a round trip per stroke, so near the owner matters); CANVAS_DATA_CENTERS changes that. Only the gallery goes to R2 (GALLERY=r2), so its
 * pictures show up in the one gallery.
 * Everything is on the drive, so a stopped pod whose host has no free GPU is simply replaced.
 */

export type CanvasState = 'unconfigured' | 'off' | 'starting' | 'downloading' | 'on' | 'error';

export interface CanvasStatus {
  state: CanvasState;
  /** What it costs per hour while on (shown before turning it on). */
  pricePerHour: number;
  /** What it costs right now, from Runpod (null while off). */
  costPerHour: number | null;
  /** The GPU it is on (or will try first). */
  gpu: string;
  /** The one auto-off rule's minutes (lib/autoOff.ts). */
  autoOffMinutes: number;
  idle: AiIdle | null;
  detail?: string;
}

const list = (v: string) => v.split(',').map((s) => s.trim()).filter(Boolean);

const canvasEnv = () => ({
  name: `${aiEnv().name}-canvas`,
  volumeId: process.env.CANVAS_GLOBAL_VOLUME_ID || '',
  // Where it may run, in order of preference (the AI machine's North American list by default).
  dataCenters: list(process.env.CANVAS_DATA_CENTERS || NA_DATA_CENTERS),
  // First choice, then the backup.
  gpus: list(process.env.CANVAS_GPU_TYPES || 'NVIDIA H200,NVIDIA RTX PRO 6000 Blackwell Server Edition'),
  // The pod's own disk holds the unpacked software (three Python environments) and the one model file
  // coming down at a time before it goes to the drive.
  diskGb: 200,
});

const GPU_NAMES: Record<string, string> = {
  'NVIDIA RTX PRO 6000 Blackwell Server Edition': 'RTX PRO 6000 96 GB',
  'NVIDIA H200': 'H200 141 GB',
};
const gpuName = (id: string | undefined) => (id ? (GPU_NAMES[id] ?? id.replace(/^NVIDIA /, '')) : '');

const ON = ['RUNNING', 'STARTING', 'PROVISIONING'];

export const canvasName = () => canvasEnv().name;
export const findCanvasPod = () => findPodNamed(canvasName());

/** Set up when the site can manage it: a Runpod key, the gate secret and the drive. */
export function canvasConfigured() {
  return Boolean(process.env.RUNPOD_API_KEY && aiEnv().secret.length >= 32 && canvasEnv().volumeId);
}

// The price changes rarely: ask Runpod at most once an hour per server instance.
let priceCache: { at: number; gpu: string; price: number | null } | null = null;

/** Runpod's Secure Cloud price for one GPU (GraphQL), or null when it can't be read. */
async function runpodPrice(gpu: string): Promise<number | null> {
  const key = process.env.RUNPOD_API_KEY;
  if (!key) return null;
  if (priceCache && priceCache.gpu === gpu && Date.now() - priceCache.at < 3_600_000) return priceCache.price;
  const query = JSON.stringify({ query: `query { gpuTypes(input: { id: ${JSON.stringify(gpu)} }) { id securePrice } }` });
  const price = await fetch('https://api.runpod.io/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: query,
    cache: 'no-store',
    signal: AbortSignal.timeout(5000),
  })
    .then((r) => (r.ok ? (r.json() as Promise<{ data?: { gpuTypes?: { securePrice?: number }[] } }>) : null))
    .then((b) => b?.data?.gpuTypes?.[0]?.securePrice)
    .catch(() => undefined);
  const value = typeof price === 'number' && price > 0 ? price : null;
  priceCache = { at: Date.now(), gpu, price: value };
  return value;
}

/** The price per hour shown before Start: CANVAS_PRICE_PER_HOUR when set, else Runpod's, else 5.29 (the H200). */
async function pricePerHour(gpu: string): Promise<number> {
  const set = Number(process.env.CANVAS_PRICE_PER_HOUR);
  if (Number.isFinite(set) && set > 0) return set;
  return (await runpodPrice(gpu).catch(() => null)) ?? 5.29;
}

/** What the drawing machine starts with. The R2 keys are only for the gallery. */
function canvasPodEnv(): Record<string, string> {
  const e = aiEnv();
  return {
    GATEWAY_SECRET: e.secret,
    REPO_RAW: repoRaw(),
    SITE_URL: siteUrl(),
    ALLOWED_ORIGINS: allowedOrigins(),
    IDLE_MINUTES: String(autoOffMinutes()),
    AI_ROLE: 'canvas',
    STORAGE: 'global',
    GALLERY: 'r2',
    ...r2SecretEnv(),
    ...hfTokenEnv(),
  };
}

/** Create the drawing machine with its drive: the H200 first, then the RTX PRO 6000 (`usualOnly`: the first only). */
export async function createCanvasPod(usualOnly = false): Promise<Pod> {
  const c = canvasEnv();
  const e = aiEnv();
  let lastError: Error | null = null;
  const started = Date.now();
  for (const gpu of usualOnly ? c.gpus.slice(0, 1) : c.gpus) {
    // Each try is one quick request; stop well inside the request's time limit.
    if (Date.now() - started > 45_000) break;
    try {
      return (await runpod('/pods', {
        method: 'POST',
        body: JSON.stringify({
          name: c.name,
          cloud: 'SECURE',
          // Blackwell needs CUDA 12.8+ (PyTorch 2.11 cu128 everywhere on this machine).
          gpu: { id: gpu, count: 1, minCudaVersion: '12.8' },
          ...(c.dataCenters.length ? { dataCenterIds: c.dataCenters } : {}),
          image: e.image,
          disk: c.diskGb,
          ports: ['8080/http'],
          mounts: { global: [{ volumeId: c.volumeId, path: '/workspace-global' }] },
          entrypoint: ['/bin/bash', '-c'],
          cmd: ['curl -fsSL "$REPO_RAW/ai/setup.sh" | bash'],
          env: canvasPodEnv(),
        }),
      })) as Pod;
    } catch (err) {
      lastError = err as Error;
    }
  }
  throw lastError ?? new Error('No GPU type configured for the drawing machine (CANVAS_GPU_TYPES).');
}

/** Create it, with a plain message when both GPUs are sold out. */
async function createOrExplain() {
  try {
    return await createCanvasPod();
  } catch (err) {
    if (!noCapacity((err as Error).message)) throw err;
    const c = canvasEnv();
    const names = c.gpus.map(gpuName);
    throw new Error(
      `No ${names[0]} GPU${names.length > 1 ? ` (or the backup, ${names.slice(1).join(', ')})` : ''} is free${c.dataCenters.length ? ` in ${c.dataCenters.join(', ')}` : ''} right now. ` +
        'This usually clears within the hour; try again in a few minutes.',
    );
  }
}

const removePod = (id: string) => runpod(`/pods/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});

/**
 * Turn the drawing machine on: create it the first time, start it (on this deployment's code and the
 * one auto-off rule), or replace it when its host has no free GPU. Safe because everything is on the drive.
 */
export async function startCanvas(): Promise<void> {
  if (!process.env.RUNPOD_API_KEY) throw new Error('Add RUNPOD_API_KEY in Vercel so the site can turn the drawing machine on.');
  if (!canvasEnv().volumeId) throw new Error("Add CANVAS_GLOBAL_VOLUME_ID in Vercel (the drawing machine's drive) so the site can turn it on.");
  const pod = await findCanvasPod();
  if (!pod) {
    await createOrExplain();
    return;
  }
  if (ON.includes(pod.status ?? '')) return;
  // Last time it landed on the backup GPU: try the usual one first (a new pod on the same drive
  // picks up where the old one left off).
  const usual = canvasEnv().gpus[0];
  if (pod.gpu?.id && usual && pod.gpu.id !== usual) {
    const fresh = await createCanvasPod(true).catch(() => null);
    if (fresh) {
      await removePod(pod.id);
      return;
    }
  }
  const want: Record<string, string> = { AI_ROLE: 'canvas', STORAGE: 'global', GALLERY: 'r2', IDLE_MINUTES: String(autoOffMinutes()), ...hfTokenEnv() };
  if (process.env.VERCEL_GIT_COMMIT_SHA) want.REPO_RAW = repoRaw();
  if (pod.env && Object.entries(want).some(([k, v]) => pod.env![k] !== v)) {
    await runpod(`/pods/${encodeURIComponent(pod.id)}`, { method: 'PATCH', body: JSON.stringify({ env: { ...pod.env, ...want } }) }).catch(() => {});
  }
  try {
    await runpod(`/pods/${encodeURIComponent(pod.id)}/action`, { method: 'POST', body: JSON.stringify({ action: 'start' }) });
  } catch (err) {
    if (!noCapacity((err as Error).message) && pod.status !== 'ERROR') throw err;
    await createOrExplain();
    await removePod(pod.id);
  }
}

export async function stopCanvas(): Promise<void> {
  if (!process.env.RUNPOD_API_KEY) throw new Error('Add RUNPOD_API_KEY in Vercel so the site can turn the drawing machine off.');
  const pod = await findCanvasPod();
  if (pod && pod.status !== 'EXITED') {
    await runpod(`/pods/${encodeURIComponent(pod.id)}/action`, { method: 'POST', body: JSON.stringify({ action: 'stop' }) });
  }
}

/** The gate's status: the AI machine's shape plus the image and video maker's (studio.js state()). */
type CanvasGateStatus = Partial<GateStatus> & { studio?: { downloading?: { name: string; percent: number } | null } | null };

export async function canvasStatus(user: string): Promise<CanvasStatus & { podId?: string }> {
  const c = canvasEnv();
  const minutes = autoOffMinutes();
  if (!canvasConfigured()) {
    return {
      state: 'unconfigured',
      pricePerHour: await pricePerHour(c.gpus[0] ?? ''),
      costPerHour: null,
      gpu: gpuName(c.gpus[0]),
      autoOffMinutes: minutes,
      idle: null,
      detail: 'The drawing machine is not set up in Vercel yet (RUNPOD_API_KEY, LINUX_GATEWAY_SECRET and CANVAS_GLOBAL_VOLUME_ID).',
    };
  }
  let pod: Pod | null;
  try {
    pod = await findCanvasPod();
  } catch (err) {
    return { state: 'error', pricePerHour: await pricePerHour(c.gpus[0] ?? ''), costPerHour: null, gpu: gpuName(c.gpus[0]), autoOffMinutes: minutes, idle: null, detail: (err as Error).message };
  }
  // A stopped pod keeps its GPU type (it resumes on the same host); a new one tries the usual GPU.
  const gpuId = pod && pod.status !== 'EXITED' && pod.gpu?.id ? pod.gpu.id : c.gpus[0] ?? '';
  const base = { pricePerHour: await pricePerHour(gpuId), gpu: gpuName(gpuId), autoOffMinutes: minutes, podId: pod?.id };
  if (!pod || pod.status === 'EXITED') return { state: 'off', costPerHour: null, idle: null, ...base };
  const cost = typeof pod.cost === 'number' && pod.cost > 0 ? pod.cost : null;
  const backup = c.gpus[0] && pod.gpu?.id && pod.gpu.id !== c.gpus[0] ? `Your usual ${gpuName(c.gpus[0])} GPU was taken, so the drawing machine is on a backup ${gpuName(pod.gpu.id)}. Next time it tries the usual one first.` : undefined;
  if (pod.status !== 'RUNNING') {
    const starting = pod.status === 'PROVISIONING' || pod.status === 'STARTING';
    return { state: starting ? 'starting' : 'error', costPerHour: cost, idle: null, ...base, detail: starting ? backup : `Runpod reports status ${pod.status ?? 'unknown'}.` };
  }
  try {
    const res = await fetch(`${aiBase(pod.id)}/_orbit/status`, {
      headers: { authorization: `Bearer ${await aiToken(user, 'orbit-ai')}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    const g = res.ok ? ((await res.json()) as CanvasGateStatus) : null;
    const dl = g?.studio?.downloading;
    // Up, but a model file is still coming down onto the drive (the first start, or a new engine).
    const state: CanvasState = !g?.ready ? 'starting' : dl ? 'downloading' : 'on';
    const detail = state === 'downloading' && dl ? `Downloading ${dl.name} (${dl.percent}%) onto the drawing machine's drive. Only the first start does this.` : backup;
    return { state, costPerHour: cost, idle: idleOf(g?.idle), ...base, detail };
  } catch {
    return { state: 'starting', costPerHour: cost, idle: null, ...base, detail: backup };
  }
}

/** "Keep on" for the drawing machine: the same rule and limits as the AI machine's. */
export async function canvasKeepOn(user: string, minutes: number) {
  const pod = await findCanvasPod();
  if (!pod || pod.status !== 'RUNNING') throw new Error('The drawing machine is not on.');
  const res = await fetch(`${aiBase(pod.id)}/_orbit/keepawake`, {
    method: 'POST',
    headers: { authorization: `Bearer ${await aiToken(user, 'orbit-ai')}`, 'content-type': 'application/json' },
    body: JSON.stringify({ minutes }),
    cache: 'no-store',
    signal: AbortSignal.timeout(30_000),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || `The drawing machine answered ${res.status}.`);
  return out;
}
