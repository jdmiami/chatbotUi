import 'server-only';
import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import { runpod, type PodStatus } from './runpod';

/**
 * The AI machine: a Runpod GPU pod running Open WebUI + Ollama behind a small gate (ai/setup.sh).
 * It is only on while used: the site creates/starts it on demand and the machine stops itself when
 * idle. Models and chats live on a network volume (AI_VOLUME_ID), so a stopped, replaced or
 * re-created machine keeps them.
 *
 * The site finds the machine by name (AI_POD_NAME) instead of a fixed id: when a stopped pod's host
 * has no free GPU, the site replaces it with a new pod on the same volume, which gets a new id.
 */

export type AiState =
  | 'unconfigured' // AI_VOLUME_ID / RUNPOD_API_KEY / secret missing
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
  idle?: { limitMinutes: number; idleMinutes: number } | null;
  /** Direct address of the AI machine (sign-in still goes through the site) and its Runpod page. */
  url?: string;
  consoleUrl?: string;
  /** Speed the machine is on (or was last on), and the speeds to choose from. */
  tier?: string | null;
  tiers?: AiTier[];
}

/** A speed choice: which GPU the AI machine runs on, what it costs, when it turns itself off. */
export interface AiTier {
  id: string;
  label: string;
  gpu: string;
  gpuName: string;
  pricePerHour: number;
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
}

const env = () => ({
  name: process.env.AI_POD_NAME || 'orbit-ai',
  volumeId: process.env.AI_VOLUME_ID || '',
  dataCenter: process.env.AI_DATA_CENTER || 'CA-MTL-1',
  gpuTypes: (process.env.AI_GPU_TYPES || 'NVIDIA A40').split(',').map((s) => s.trim()).filter(Boolean),
  image: process.env.AI_IMAGE || 'ghcr.io/open-webui/open-webui:0.12.2-ollama',
  // The machines never wait longer than 20 minutes without a job (the gate enforces it too).
  idleMinutes: String(Math.min(Number(process.env.AI_IDLE_MINUTES) || 20, 20)),
  models: process.env.AI_MODELS || 'qwen3.8:27b,qwen3.6:35b,qwen3.8-obliterated:27b=hf.co/OBLITERATUS/Qwen3.8-27B-OBLITERATED:Q6_K|like=qwen3.8:27b|temperature=0|repeat_penalty=1.15',
  secret: process.env.LINUX_GATEWAY_SECRET || '',
});

/**
 * Speeds to choose from. Both default GPUs are in the volume's data center (a pod can only use a
 * network volume in its own data center). Override with AI_TIERS (JSON array of AiTier).
 */
export function aiTiers(): AiTier[] {
  try {
    const custom = JSON.parse(process.env.AI_TIERS || 'null');
    if (Array.isArray(custom) && custom.length) return custom as AiTier[];
  } catch {
    /* fall back to the defaults */
  }
  return [
    { id: 'standard', label: 'Standard', gpu: env().gpuTypes[0] || 'NVIDIA A40', gpuName: 'A40 48 GB', pricePerHour: 0.59, idleMinutes: Number(env().idleMinutes) || 20, speed: 'normal speed' },
    { id: 'turbo', label: 'Turbo', gpu: 'NVIDIA H100 80GB HBM3', gpuName: 'H100 80 GB', pricePerHour: 3.99, idleMinutes: 10, speed: 'about 4–6× faster' },
  ];
}
const tierOf = (pod: Pod | null) => (pod?.gpu?.id ? (aiTiers().find((t) => t.gpu === pod.gpu!.id) ?? null) : null);

/**
 * Set up when the site can manage the machine (Runpod key + volume), or at least knows a fixed
 * machine (AI_POD_ID) it can use whenever that machine is on.
 */
export function aiConfigured() {
  const e = env();
  if (e.secret.length < 32) return false;
  return Boolean((process.env.RUNPOD_API_KEY && e.volumeId) || process.env.AI_POD_ID);
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
 * The helper: an optional second AI machine on the same volume that only makes images and videos
 * (soReal can make two movies at once). Same GPU and price as Standard; it turns itself off when idle.
 */
const helperName = () => `${env().name}-helper`;
export const findHelperPod = () => findPodNamed(helperName());

async function createAiPod(tier: AiTier, role: 'main' | 'helper' = 'main'): Promise<Pod> {
  const e = env();
  const origins = process.env.LINUX_ALLOWED_ORIGINS || [siteUrl(), 'https://chatbot-ui-62nj-*-jdmiamis-projects.vercel.app'].filter(Boolean).join(',');
  let lastError: Error | null = null;
  for (const gpu of [tier.gpu]) {
    try {
      return (await runpod('/pods', {
        method: 'POST',
        body: JSON.stringify({
          name: role === 'helper' ? helperName() : e.name,
          cloud: 'SECURE',
          // 12.8+: the image/video maker uses a CUDA 12.8 build of PyTorch.
          gpu: { id: gpu, count: 1, minCudaVersion: '12.8' },
          dataCenterIds: [e.dataCenter],
          image: e.image,
          disk: 40,
          ports: ['8080/http'],
          mounts: { network: [{ volumeId: e.volumeId, path: '/workspace' }] },
          entrypoint: ['/bin/bash', '-c'],
          cmd: ['curl -fsSL "$REPO_RAW/ai/setup.sh" | bash'],
          env: {
            GATEWAY_SECRET: e.secret,
            REPO_RAW: repoRaw(),
            SITE_URL: siteUrl(),
            ALLOWED_ORIGINS: origins,
            IDLE_MINUTES: String(tier.idleMinutes),
            DEFAULT_MODELS: e.models,
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

/** Runpod says there's no GPU left on the stopped pod's own machine (it can only resume there). */
const noCapacity = (msg: string) =>
  /not enough|no (gpu|longer|instances?)|insufficient|capacity|unavailable|not available|free gpu/i.test(msg);

const noGpu = (tier: AiTier, others: AiTier[]) =>
  `No ${tier.label} GPU (${tier.gpuName}) is free right now: Runpod is out of them in its data center. ` +
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
 * Models, chats and creations are on the network volume, so a new pod picks up where the old left off.
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
  if (current && current.gpu !== tier.gpu) {
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
  // Run the same code version and default models as this deployment: update a stopped machine
  // before starting it.
  const want: Record<string, string> = { DEFAULT_MODELS: env().models, IDLE_MINUTES: String(tier.idleMinutes) };
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
    // Everything worth keeping is on the network volume, so a fresh pod picks up where it left off.
    // If no GPU is free anywhere in the volume's data center either, keep the old pod and say so.
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
  const want: Record<string, string> = { AI_ROLE: 'helper', IDLE_MINUTES: String(tier.idleMinutes) };
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
  idle?: { limitMinutes: number; idleMinutes: number } | null;
}

export async function helperStatus(user: string): Promise<HelperStatus & { podId?: string }> {
  const pricePerHour = aiTiers()[0].pricePerHour;
  if (!aiConfigured() || !process.env.RUNPOD_API_KEY) return { state: 'unconfigured', costPerHour: null, pricePerHour };
  let pod: Pod | null;
  try {
    pod = await findHelperPod();
  } catch (err) {
    return { state: 'error', costPerHour: null, pricePerHour, detail: (err as Error).message };
  }
  if (!pod || pod.status === 'EXITED') return { state: 'off', costPerHour: null, pricePerHour, podId: pod?.id };
  const cost = typeof pod.cost === 'number' && pod.cost > 0 ? pod.cost : null;
  if (pod.status !== 'RUNNING') {
    const state = pod.status === 'PROVISIONING' || pod.status === 'STARTING' ? 'starting' : 'error';
    return { state, costPerHour: cost, pricePerHour, podId: pod.id, detail: state === 'error' ? `Runpod reports status ${pod.status ?? 'unknown'}.` : undefined };
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
      pricePerHour,
      podId: pod.id,
      idle: g?.idle ? { limitMinutes: g.idle.limitMinutes, idleMinutes: g.idle.idleMinutes } : null,
    };
  } catch {
    return { state: 'starting', costPerHour: cost, pricePerHour, podId: pod.id };
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
  idle?: { limitMinutes: number; idleMinutes: number };
}

export async function aiStatus(user: string): Promise<AiStatus & { podId?: string }> {
  if (!aiConfigured()) {
    return { state: 'unconfigured', costPerHour: null, detail: 'The AI machine is not set up in Vercel yet (AI_VOLUME_ID).' };
  }
  let pod: Pod | null;
  try {
    pod = await findAiPod();
  } catch (err) {
    return { state: 'error', costPerHour: null, detail: (err as Error).message };
  }
  const speeds = { tiers: aiTiers(), tier: tierOf(pod)?.id ?? null };
  if (!pod) return { state: 'off', costPerHour: null, ...speeds };
  const cost = typeof pod.cost === 'number' && pod.cost > 0 ? pod.cost : null;
  switch (pod.status) {
    case 'EXITED':
      return { state: 'off', costPerHour: null, podId: pod.id, ...speeds };
    case 'PROVISIONING':
    case 'STARTING':
      return { state: 'starting', costPerHour: cost, podId: pod.id, ...speeds };
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
    if (!res.ok) return { state: 'starting', costPerHour: cost, podId: pod.id, ...speeds };
    const g = (await res.json()) as GateStatus;
    // Usable as soon as one model is there; later downloads show as progress.
    const state: AiState = !g.ready ? 'starting' : g.models.length ? 'on' : 'downloading';
    return {
      state,
      costPerHour: cost,
      podId: pod.id,
      pulling: g.pulling,
      models: g.models.map((m) => m.name),
      idle: g.idle ? { limitMinutes: g.idle.limitMinutes, idleMinutes: g.idle.idleMinutes } : null,
      ...speeds,
    };
  } catch {
    return { state: 'starting', costPerHour: cost, podId: pod.id, ...speeds };
  }
}
