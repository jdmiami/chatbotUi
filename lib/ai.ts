import 'server-only';
import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import { runpod, type PodStatus } from './runpod';
import { autoOffMinutes } from './autoOff';

/**
 * The AI machine: a Runpod GPU pod running Open WebUI + Ollama behind a small gate (ai/setup.sh).
 * It is only on while used: the site creates/starts it on demand and the machine stops itself when
 * idle. Models, chats and creations are kept in Cloudflare R2 (bucket orbit-models; keys are Runpod
 * secrets r2_account_id, r2_access_key_id, r2_secret_access_key): the machine has no network volume,
 * its disk is wiped at every stop, and it brings everything back down from R2 at start. So any
 * machine in any data center can pick up where the last one left off. AI_STORAGE=volume (with
 * AI_VOLUME_ID) keeps the old way: a Runpod network volume at /workspace.
 *
 * The site finds the machine by name (AI_POD_NAME) instead of a fixed id: when a stopped pod's host
 * has no free GPU, the site replaces it with a new pod, which gets a new id.
 */

export type AiState =
  | 'unconfigured' // RUNPOD_API_KEY / secret missing (or AI_VOLUME_ID with AI_STORAGE=volume)
  | 'off' // stopped or not created yet: costs nothing per hour
  | 'starting' // booting, installing, or Open WebUI/Ollama not answering yet
  | 'downloading' // up, but still downloading the default models (first start)
  | 'on'
  | 'error';

export interface AiStatus {
  state: AiState;
  costPerHour: number | null;
  detail?: string;
  /** Model download in progress (first start, or a newly added default model). */
  pulling?: { model: string; percent: number } | null;
  models?: string[];
  idle?: AiIdle | null;
  /** The one auto-off rule's minutes (lib/autoOff.ts), for screens to show before the machine reports its own. */
  autoOffMinutes?: number;
  /** Direct address of the AI machine (sign-in still goes through the site) and its Runpod page. */
  url?: string;
  consoleUrl?: string;
  /** Speed the machine is on (or was last on), and the speeds to choose from. */
  tier?: string | null;
  tiers?: AiTier[];
}

/** The machine's own auto-off timer (shared/autooff.js), as its gate reports it. */
export interface AiIdle {
  limitMinutes: number;
  idleMinutes: number;
  offAt?: string | null;
  heldUntil?: string | null;
}

/** A speed choice: which GPU the AI machine runs on and what it costs. Every speed turns off by the same rule. */
export interface AiTier {
  id: string;
  label: string;
  gpu: string;
  /** Other GPUs of the same speed and price, tried when `gpu` is sold out. */
  alsoGpus?: string[];
  /**
   * Backups when every GPU above is sold out everywhere: at least as fast, may cost a bit more
   * (never more than `maxFallbackPrice`). Tried cheapest first.
   */
  fallbacks?: { gpu: string; gpuName: string; pricePerHour: number }[];
  maxFallbackPrice?: number;
  gpuName: string;
  pricePerHour: number;
  /** Always the one auto-off rule's minutes (lib/autoOff.ts), whatever AI_TIERS says. */
  idleMinutes: number;
  /** Plain-words speed compared to Standard. */
  speed: string;
}

interface Pod {
  id: string;
  name: string;
  status?: PodStatus;
  cost?: number;
  createdAt?: string;
  env?: Record<string, string>;
  gpu?: { id?: string } | null;
  dataCenterId?: string;
}

// North American Secure Cloud data centers, tried in this order (R2's bucket is in eastern North America).
const NA_DATA_CENTERS = 'US-NC-1,US-NC-2,US-PA-1,US-MD-1,US-GA-2,US-IL-1,US-MO-1,US-MO-2,US-KS-2,US-NE-1,US-TX-3,US-TX-4,US-CO-1,US-CA-2,US-WA-1,US-WA-2,CA-MTL-1,CA-MTL-3,CA-MTL-4';
const list = (v: string) => v.split(',').map((s) => s.trim()).filter(Boolean);

const env = () => ({
  name: process.env.AI_POD_NAME || 'orbit-ai',
  // 'r2' (default): no network volume, everything kept in R2. 'volume': the network volume AI_VOLUME_ID.
  storage: process.env.AI_STORAGE === 'volume' ? ('volume' as const) : ('r2' as const),
  volumeId: process.env.AI_VOLUME_ID || '',
  dataCenters: process.env.AI_STORAGE === 'volume' ? [process.env.AI_DATA_CENTER || 'CA-MTL-1'] : list(process.env.AI_DATA_CENTERS || NA_DATA_CENTERS),
  // Standard: whichever of these is free (both 48 GB, same price).
  gpuTypes: list(process.env.AI_GPU_TYPES || 'NVIDIA A40,NVIDIA RTX A6000'),
  image: process.env.AI_IMAGE || 'ghcr.io/open-webui/open-webui:0.12.2-ollama',
  models: process.env.AI_MODELS || 'qwen3.8:27b,qwen3.6:35b,qwen3.8-obliterated:27b=hf.co/OBLITERATUS/Qwen3.8-27B-OBLITERATED:Q6_K|like=qwen3.8:27b|temperature=0|repeat_penalty=1.15',
  secret: process.env.LINUX_GATEWAY_SECRET || '',
});

/**
 * Speeds to choose from. Override with AI_TIERS (JSON array of AiTier). Every speed turns itself off
 * by the same rule (autoOffMinutes()); a custom list can't change that.
 */
export function aiTiers(): AiTier[] {
  const minutes = autoOffMinutes();
  return tierList().map((t) => ({ ...t, idleMinutes: minutes }));
}

function tierList(): AiTier[] {
  try {
    const custom = JSON.parse(process.env.AI_TIERS || 'null');
    if (Array.isArray(custom) && custom.length) return custom as AiTier[];
  } catch {
    /* fall back to the defaults */
  }
  const minutes = autoOffMinutes();
  return [
    {
      id: 'standard',
      label: 'Standard',
      gpu: env().gpuTypes[0] || 'NVIDIA A40',
      alsoGpus: env().gpuTypes.slice(1),
      gpuName: 'A40 / A6000 48 GB',
      pricePerHour: 0.59,
      idleMinutes: minutes,
      speed: 'normal speed',
      // Same 48 GB of memory (everything fits), newer and a little faster, a little dearer.
      fallbacks: [
        { gpu: 'NVIDIA L40', gpuName: 'L40 48 GB', pricePerHour: 0.82 },
        { gpu: 'NVIDIA RTX 6000 Ada Generation', gpuName: 'RTX 6000 Ada 48 GB', pricePerHour: 0.99 },
        { gpu: 'NVIDIA L40S', gpuName: 'L40S 48 GB', pricePerHour: 1.09 },
      ],
      maxFallbackPrice: Number(process.env.AI_MAX_FALLBACK_PRICE) || 1.1,
    },
    {
      id: 'turbo',
      label: 'Turbo',
      gpu: 'NVIDIA H100 PCIe',
      gpuName: 'H100 80 GB',
      pricePerHour: 2.89,
      idleMinutes: minutes,
      speed: 'about 3–4× faster',
      // Big, fast GPUs that never cost more than Turbo itself.
      fallbacks: [
        { gpu: 'NVIDIA A100-SXM4-80GB', gpuName: 'A100 80 GB', pricePerHour: 1.79 },
        { gpu: 'NVIDIA A100 80GB PCIe', gpuName: 'A100 80 GB', pricePerHour: 1.79 },
        { gpu: 'NVIDIA RTX PRO 6000 Blackwell Server Edition', gpuName: 'RTX PRO 6000 96 GB', pricePerHour: 2.49 },
      ],
      maxFallbackPrice: 2.89,
    },
  ];
}
const gpusOf = (t: AiTier) => [t.gpu, ...(t.alsoGpus ?? [])];
const fallbacksOf = (t: AiTier) =>
  (t.fallbacks ?? []).filter((f) => f.pricePerHour <= (t.maxFallbackPrice ?? t.pricePerHour)).sort((a, b) => a.pricePerHour - b.pricePerHour);
const tierOf = (pod: Pod | null) => {
  const id = pod?.gpu?.id;
  if (!id) return null;
  const tiers = aiTiers();
  return tiers.find((t) => gpusOf(t).includes(id)) ?? tiers.find((t) => fallbacksOf(t).some((f) => f.gpu === id)) ?? null;
};
/** On a backup GPU, or outside the usual (North American) data centers: try the usual place again next start. */
const onBackup = (pod: Pod, tier: AiTier) =>
  !gpusOf(tier).includes(pod.gpu?.id ?? '') || Boolean(pod.dataCenterId && !env().dataCenters.includes(pod.dataCenterId));

/**
 * Set up when the site can manage the machine (Runpod key, plus the volume in volume mode), or at
 * least knows a fixed machine (AI_POD_ID) it can use whenever that machine is on.
 */
export function aiConfigured() {
  const e = env();
  if (e.secret.length < 32) return false;
  return Boolean((process.env.RUNPOD_API_KEY && (e.storage === 'r2' || e.volumeId)) || process.env.AI_POD_ID);
}

async function gateUp(podId: string) {
  try {
    const res = await fetch(`${aiBase(podId)}/healthz`, { cache: 'no-store', signal: AbortSignal.timeout(4000) });
    return res.ok;
  } catch {
    return false;
  }
}

export const aiBase = (podId: string) => `https://${podId}-8080.proxy.runpod.net`;
export const aiConsole = (podId: string) => `https://console.runpod.io/pods?id=${encodeURIComponent(podId)}`;

/** The code version the machine runs: the same commit as this deployment (falls back to main). */
function repoRaw() {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA;
  return `https://raw.githubusercontent.com/jdmiami/chatbotUi/${sha || 'main'}`;
}

function siteUrl() {
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return prod ? `https://${prod}` : '';
}

/** The newest live pod with this name, or null. */
async function findPodNamed(name: string): Promise<Pod | null> {
  const body = (await runpod('/pods')) as { pods?: Pod[] } | Pod[];
  const pods = (Array.isArray(body) ? body : (body.pods ?? [])).filter((p) => p.name === name && p.status !== 'TERMINATED');
  pods.sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
  return pods[0] ?? null;
}

/** The newest live pod with the AI machine's name, or null. */
export async function findAiPod(): Promise<Pod | null> {
  const fixed = process.env.AI_POD_ID;
  if (fixed && !process.env.RUNPOD_API_KEY) {
    // No Runpod key: we can't see or change its power state, only whether it answers.
    return { id: fixed, name: env().name, status: (await gateUp(fixed)) ? 'RUNNING' : 'EXITED' };
  }
  return findPodNamed(env().name);
}

/**
 * The helper: an optional second AI machine that only makes images and videos
 * (soReal can make two movies at once). Same GPU and price as Standard; it turns itself off when idle.
 */
const helperName = () => `${env().name}-helper`;
export const findHelperPod = () => findPodNamed(helperName());

/**
 * Where to look for a GPU, in order (cheapest first): the tier's own GPUs in North America, then
 * anywhere in the world (everything comes from R2, so any data center works), then the backup GPUs
 * in North America, then anywhere. With a network volume only its data center can work.
 * `usualOnly` stops after the tier's own GPUs in North America.
 */
function placements(tier: AiTier, usualOnly = false) {
  const e = env();
  const na = e.dataCenters;
  const anywhere = e.storage === 'r2' && process.env.AI_WORLDWIDE !== 'off' ? [null] : [];
  const out: { gpu: string; dataCenters: string[] | null }[] = [];
  for (const where of [na, ...(usualOnly ? [] : anywhere)]) for (const gpu of gpusOf(tier)) out.push({ gpu, dataCenters: where });
  if (!usualOnly) for (const where of [na, ...anywhere]) for (const f of fallbacksOf(tier)) out.push({ gpu: f.gpu, dataCenters: where });
  return out;
}

/**
 * The AI machine's own disk (GB) with R2: what it holds while on (chat models, makers, the maker's
 * software). 400 by default: the built-ins and chat models take about 135 GB, and a video maker
 * 25–55 GB each. AI_DISK_GB changes it (it applies to the next machine the site creates).
 * Runpod bills it only while the machine runs (about $0.10 per GB a month).
 */
export function aiDiskGb() {
  const n = Number(process.env.AI_DISK_GB);
  return Number.isFinite(n) && n >= 100 && n <= 2000 ? Math.round(n) : 400;
}

async function createAiPod(tier: AiTier, role: 'main' | 'helper' = 'main', usualOnly = false): Promise<Pod> {
  const e = env();
  const origins = process.env.LINUX_ALLOWED_ORIGINS || [siteUrl(), 'https://chatbot-ui-62nj-*-jdmiamis-projects.vercel.app'].filter(Boolean).join(',');
  let lastError: Error | null = null;
  const r2 = e.storage === 'r2';
  const started = Date.now();
  for (const { gpu, dataCenters } of placements(tier, usualOnly)) {
    // Each try is one quick request; stop well inside the request's time limit.
    if (Date.now() - started > 45_000) break;
    try {
      return (await runpod('/pods', {
        method: 'POST',
        body: JSON.stringify({
          name: role === 'helper' ? helperName() : e.name,
          cloud: 'SECURE',
          // 12.8+: the image/video maker uses a CUDA 12.8 build of PyTorch.
          gpu: { id: gpu, count: 1, minCudaVersion: '12.8' },
          ...(dataCenters ? { dataCenterIds: dataCenters } : {}),
          image: e.image,
          // With R2 the models are unpacked onto the pod's own disk at every start (it is only billed
          // while the machine is on and is wiped when it stops).
          disk: r2 ? aiDiskGb() : 40,
          ports: ['8080/http'],
          ...(r2 ? {} : { mounts: { network: [{ volumeId: e.volumeId, path: '/workspace' }] } }),
          entrypoint: ['/bin/bash', '-c'],
          cmd: ['curl -fsSL "$REPO_RAW/ai/setup.sh" | bash'],
          env: {
            GATEWAY_SECRET: e.secret,
            REPO_RAW: repoRaw(),
            SITE_URL: siteUrl(),
            ALLOWED_ORIGINS: origins,
            IDLE_MINUTES: String(autoOffMinutes()),
            DEFAULT_MODELS: e.models,
            ...(r2
              ? {
                  STORAGE: 'r2',
                  // Runpod fills these in from its secrets; the site never sees the keys.
                  R2_ACCOUNT_ID: '{{ RUNPOD_SECRET_r2_account_id }}',
                  R2_ACCESS_KEY_ID: '{{ RUNPOD_SECRET_r2_access_key_id }}',
                  R2_SECRET_ACCESS_KEY: '{{ RUNPOD_SECRET_r2_secret_access_key }}',
                }
              : {}),
            ...hfTokenEnv(),
            ...(role === 'helper' ? { AI_ROLE: 'helper' } : {}),
          },
        }),
      })) as Pod;
    } catch (err) {
      lastError = err as Error;
    }
  }
  throw lastError ?? new Error('No GPU type configured');
}

/**
 * Gated model files (LTX-2.5) need a Hugging Face token on the AI machine: Runpod fills it in from the
 * secret named in AI_HF_TOKEN_SECRET (the site never sees the token). Unset: nothing is passed.
 */
function hfTokenEnv(): Record<string, string> {
  const name = (process.env.AI_HF_TOKEN_SECRET || '').trim();
  return /^[A-Za-z0-9_-]{1,64}$/.test(name) ? { HF_TOKEN: `{{ RUNPOD_SECRET_${name} }}` } : {};
}

/** Runpod says there's no GPU left on the stopped pod's own machine (it can only resume there). */
const noCapacity = (msg: string) =>
  /not enough|no (gpu|longer|instances?)|insufficient|capacity|unavailable|not available|free gpu/i.test(msg);

const noGpu = (tier: AiTier, others: AiTier[]) =>
  `No ${tier.label} GPU (${tier.gpuName}${fallbacksOf(tier).length ? `, or a backup: ${fallbacksOf(tier).map((f) => f.gpuName).join(', ')}` : ''}) is free anywhere right now. ` +
  (others.length ? `Try ${others.map((t) => t.label).join(' or ')}, or try again in a few minutes.` : 'This usually clears within the hour; try again in a few minutes.');

/** Create a pod for `tier`, with a clear message when that GPU is sold out. */
async function createOrExplain(tier: AiTier, role: 'main' | 'helper' = 'main') {
  try {
    return await createAiPod(tier, role);
  } catch (err) {
    if (noCapacity((err as Error).message)) throw new Error(noGpu(tier, aiTiers().filter((t) => t.id !== tier.id)));
    throw err;
  }
}

async function waitStopped(podId: string, ms = 45_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const p = (await runpod(`/pods/${encodeURIComponent(podId)}`).catch(() => null)) as Pod | null;
    if (!p || p.status === 'EXITED' || p.status === 'TERMINATED') return;
    await new Promise((r) => setTimeout(r, 3000));
  }
}

/**
 * Turn the AI machine on at the chosen speed (default: the speed it was last on). Starts it,
 * creates it, moves it to the other speed's GPU, or replaces it when its host has no free GPU.
 * Models, chats and creations are kept in R2 (or on the network volume), so a new pod picks up where the old left off.
 */
export async function startAi(tierId?: string): Promise<void> {
  if (!process.env.RUNPOD_API_KEY) throw new Error('Add RUNPOD_API_KEY in Vercel so the site can turn the AI machine on.');
  const tiers = aiTiers();
  const pod = await findAiPod();
  const tier = tiers.find((t) => t.id === tierId) ?? tierOf(pod) ?? tiers[0];
  if (!pod) {
    await createOrExplain(tier);
    return;
  }
  const current = tierOf(pod);
  if (current && current.id !== tier.id) {
    // Another speed: stop this machine, start one on the other GPU, then remove the old one.
    if (pod.status !== 'EXITED') {
      await runpod(`/pods/${encodeURIComponent(pod.id)}/action`, { method: 'POST', body: JSON.stringify({ action: 'stop' }) }).catch(() => {});
      await waitStopped(pod.id);
    }
    await createOrExplain(tier);
    await runpod(`/pods/${encodeURIComponent(pod.id)}`, { method: 'DELETE' }).catch(() => {});
    return;
  }
  if (pod.status === 'RUNNING' || pod.status === 'STARTING' || pod.status === 'PROVISIONING') return;
  // Last time it landed on a backup GPU or far away: with everything in R2 a new machine costs nothing
  // extra (a stopped one starts from an empty disk too), so try the usual GPU first.
  if (env().storage === 'r2' && onBackup(pod, tier)) {
    const fresh = await createAiPod(tier, 'main', true).catch(() => null);
    if (fresh) {
      await runpod(`/pods/${encodeURIComponent(pod.id)}`, { method: 'DELETE' }).catch(() => {});
      return;
    }
  }
  // Run the same code version and default models as this deployment: update a stopped machine
  // before starting it.
  const want: Record<string, string> = { DEFAULT_MODELS: env().models, IDLE_MINUTES: String(autoOffMinutes()), ...hfTokenEnv() };
  if (process.env.VERCEL_GIT_COMMIT_SHA) want.REPO_RAW = repoRaw();
  if (pod.env && Object.entries(want).some(([k, v]) => pod.env![k] !== v)) {
    await runpod(`/pods/${encodeURIComponent(pod.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ env: { ...pod.env, ...want } }),
    }).catch(() => {});
  }
  try {
    await runpod(`/pods/${encodeURIComponent(pod.id)}/action`, { method: 'POST', body: JSON.stringify({ action: 'start' }) });
  } catch (err) {
    if (!noCapacity((err as Error).message) && pod.status !== 'ERROR') throw err;
    // Everything worth keeping is in R2 (or on the network volume), so a fresh pod picks up where it
    // left off. If no GPU is free anywhere either, keep the old pod and say so.
    await createOrExplain(tier);
    await runpod(`/pods/${encodeURIComponent(pod.id)}`, { method: 'DELETE' }).catch(() => {});
  }
}

export async function stopAi(): Promise<void> {
  if (!process.env.RUNPOD_API_KEY) throw new Error('Add RUNPOD_API_KEY in Vercel so the site can turn the AI machine off.');
  const pod = await findAiPod();
  if (pod && pod.status !== 'EXITED') {
    await runpod(`/pods/${encodeURIComponent(pod.id)}/action`, { method: 'POST', body: JSON.stringify({ action: 'stop' }) });
  }
}

/** Turn the helper on (Standard GPU). Creates it the first time; replaces it when its host has no free GPU. */
export async function startHelper(): Promise<void> {
  if (!process.env.RUNPOD_API_KEY) throw new Error('Add RUNPOD_API_KEY in Vercel so the site can turn the helper on.');
  const tier = aiTiers()[0];
  const pod = await findHelperPod();
  if (!pod) {
    await createOrExplain(tier, 'helper');
    return;
  }
  if (pod.status === 'RUNNING' || pod.status === 'STARTING' || pod.status === 'PROVISIONING') return;
  const want: Record<string, string> = { AI_ROLE: 'helper', IDLE_MINUTES: String(autoOffMinutes()), ...hfTokenEnv() };
  if (process.env.VERCEL_GIT_COMMIT_SHA) want.REPO_RAW = repoRaw();
  if (pod.env && Object.entries(want).some(([k, v]) => pod.env![k] !== v)) {
    await runpod(`/pods/${encodeURIComponent(pod.id)}`, { method: 'PATCH', body: JSON.stringify({ env: { ...pod.env, ...want } }) }).catch(() => {});
  }
  try {
    await runpod(`/pods/${encodeURIComponent(pod.id)}/action`, { method: 'POST', body: JSON.stringify({ action: 'start' }) });
  } catch (err) {
    if (!noCapacity((err as Error).message) && pod.status !== 'ERROR') throw err;
    await createOrExplain(tier, 'helper');
    await runpod(`/pods/${encodeURIComponent(pod.id)}`, { method: 'DELETE' }).catch(() => {});
  }
}

export async function stopHelper(): Promise<void> {
  if (!process.env.RUNPOD_API_KEY) throw new Error('Add RUNPOD_API_KEY in Vercel so the site can turn the helper off.');
  const pod = await findHelperPod();
  if (pod && pod.status !== 'EXITED') {
    await runpod(`/pods/${encodeURIComponent(pod.id)}/action`, { method: 'POST', body: JSON.stringify({ action: 'stop' }) });
  }
}

export interface HelperStatus {
  state: 'unconfigured' | 'off' | 'starting' | 'on' | 'error';
  costPerHour: number | null;
  /** What it costs per hour while on (shown before turning it on). */
  pricePerHour: number;
  detail?: string;
  idle?: AiIdle | null;
  /** The one auto-off rule's minutes (lib/autoOff.ts). */
  autoOffMinutes: number;
}

export async function helperStatus(user: string): Promise<HelperStatus & { podId?: string }> {
  const pricePerHour = aiTiers()[0].pricePerHour;
  const rule = { pricePerHour, autoOffMinutes: autoOffMinutes() };
  if (!aiConfigured() || !process.env.RUNPOD_API_KEY) return { state: 'unconfigured', costPerHour: null, ...rule };
  let pod: Pod | null;
  try {
    pod = await findHelperPod();
  } catch (err) {
    return { state: 'error', costPerHour: null, ...rule, detail: (err as Error).message };
  }
  if (!pod || pod.status === 'EXITED') return { state: 'off', costPerHour: null, ...rule, podId: pod?.id };
  const cost = typeof pod.cost === 'number' && pod.cost > 0 ? pod.cost : null;
  if (pod.status !== 'RUNNING') {
    const state = pod.status === 'PROVISIONING' || pod.status === 'STARTING' ? 'starting' : 'error';
    return { state, costPerHour: cost, ...rule, podId: pod.id, detail: state === 'error' ? `Runpod reports status ${pod.status ?? 'unknown'}.` : undefined };
  }
  try {
    const res = await fetch(`${aiBase(pod.id)}/_orbit/status`, {
      headers: { authorization: `Bearer ${await aiToken(user, 'orbit-ai')}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    const g = res.ok ? ((await res.json()) as GateStatus) : null;
    return {
      state: g?.ready ? 'on' : 'starting',
      costPerHour: cost,
      ...rule,
      podId: pod.id,
      idle: idleOf(g?.idle),
    };
  } catch {
    return { state: 'starting', costPerHour: cost, ...rule, podId: pod.id };
  }
}

/** A token for the AI machine's gate. Audience orbit-ai (API/status) or orbit-ai-login (browser sign-in). */
export async function aiToken(user: string, audience: 'orbit-ai' | 'orbit-ai-login') {
  const jwt = new SignJWT({ scope: 'ai' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user)
    .setIssuer('rdp-web')
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(audience === 'orbit-ai-login' ? '90s' : '60m');
  if (audience === 'orbit-ai-login') jwt.setJti(randomUUID());
  return jwt.sign(new TextEncoder().encode(env().secret));
}

interface GateStatus {
  ready: boolean;
  models: { name: string }[];
  pulling: { model: string; percent: number } | null;
  defaultModels: string[];
  idle?: AiIdle;
}

/** The gate's timer, as the screens need it. */
function idleOf(i: AiIdle | undefined | null): AiIdle | null {
  return i ? { limitMinutes: i.limitMinutes, idleMinutes: i.idleMinutes, offAt: i.offAt ?? null, heldUntil: i.heldUntil ?? null } : null;
}

export async function aiStatus(user: string): Promise<AiStatus & { podId?: string }> {
  if (!aiConfigured()) {
    return { state: 'unconfigured', costPerHour: null, detail: 'The AI machine is not set up in Vercel yet (RUNPOD_API_KEY and LINUX_GATEWAY_SECRET).' };
  }
  let pod: Pod | null;
  try {
    pod = await findAiPod();
  } catch (err) {
    return { state: 'error', costPerHour: null, detail: (err as Error).message };
  }
  const speeds = { tiers: aiTiers(), tier: tierOf(pod)?.id ?? null, autoOffMinutes: autoOffMinutes() };
  if (!pod) return { state: 'off', costPerHour: null, ...speeds };
  const t = tierOf(pod);
  const backup = pod.status !== 'EXITED' && t && onBackup(pod, t) ? backupNote(pod, t) : undefined;
  const cost = typeof pod.cost === 'number' && pod.cost > 0 ? pod.cost : null;
  switch (pod.status) {
    case 'EXITED':
      return { state: 'off', costPerHour: null, podId: pod.id, ...speeds };
    case 'PROVISIONING':
    case 'STARTING':
      return { state: 'starting', costPerHour: cost, podId: pod.id, detail: backup, ...speeds };
    case 'RUNNING':
      break;
    default:
      return { state: 'error', costPerHour: cost, podId: pod.id, detail: `Runpod reports status ${pod.status ?? 'unknown'}.`, ...speeds };
  }
  try {
    const res = await fetch(`${aiBase(pod.id)}/_orbit/status`, {
      headers: { authorization: `Bearer ${await aiToken(user, 'orbit-ai')}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { state: 'starting', costPerHour: cost, podId: pod.id, detail: backup, ...speeds };
    const g = (await res.json()) as GateStatus;
    // Usable as soon as one model is there; later downloads show as progress.
    const state: AiState = !g.ready ? 'starting' : g.models.length ? 'on' : 'downloading';
    return {
      state,
      costPerHour: cost,
      podId: pod.id,
      pulling: g.pulling,
      models: g.models.map((m) => m.name),
      idle: idleOf(g.idle),
      detail: backup,
      ...speeds,
    };
  } catch {
    return { state: 'starting', costPerHour: cost, podId: pod.id, detail: backup, ...speeds };
  }
}

/** Plain words for a machine on a backup GPU or far from home. */
function backupNote(pod: Pod, tier: AiTier) {
  const f = fallbacksOf(tier).find((x) => x.gpu === pod.gpu?.id);
  const where = pod.dataCenterId && !env().dataCenters.includes(pod.dataCenterId) ? ` in ${pod.dataCenterId}` : '';
  const what = f ? `a backup ${f.gpuName} GPU ($${f.pricePerHour.toFixed(2)}/hour)` : 'your usual GPU';
  return `Your usual ${tier.gpuName} GPUs were taken, so this machine is on ${what}${where}. Next time it tries the usual one first.`;
}
