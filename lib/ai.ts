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
}

interface Pod {
  id: string;
  name: string;
  status?: PodStatus;
  cost?: number;
  createdAt?: string;
}

const env = () => ({
  name: process.env.AI_POD_NAME || 'orbit-ai',
  volumeId: process.env.AI_VOLUME_ID || '',
  dataCenter: process.env.AI_DATA_CENTER || 'CA-MTL-1',
  gpuTypes: (process.env.AI_GPU_TYPES || 'NVIDIA A40').split(',').map((s) => s.trim()).filter(Boolean),
  image: process.env.AI_IMAGE || 'ghcr.io/open-webui/open-webui:0.12.2-ollama',
  idleMinutes: process.env.AI_IDLE_MINUTES || '30',
  models: process.env.AI_MODELS || 'qwen3.8:27b,qwen3.6:35b',
  secret: process.env.LINUX_GATEWAY_SECRET || '',
});

export function aiConfigured() {
  const e = env();
  return Boolean(process.env.RUNPOD_API_KEY && e.volumeId && e.secret.length >= 32);
}

export const aiBase = (podId: string) => `https://${podId}-8080.proxy.runpod.net`;

/** The code version the machine runs: the same commit as this deployment (falls back to main). */
function repoRaw() {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA;
  return `https://raw.githubusercontent.com/jdmiami/chatbotUi/${sha || 'main'}`;
}

function siteUrl() {
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return prod ? `https://${prod}` : '';
}

/** The newest live pod with the AI machine's name, or null. */
export async function findAiPod(): Promise<Pod | null> {
  const body = (await runpod('/pods')) as { pods?: Pod[] } | Pod[];
  const pods = (Array.isArray(body) ? body : (body.pods ?? [])).filter((p) => p.name === env().name && p.status !== 'TERMINATED');
  pods.sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
  return pods[0] ?? null;
}

async function createAiPod(): Promise<Pod> {
  const e = env();
  const origins = process.env.LINUX_ALLOWED_ORIGINS || [siteUrl(), 'https://chatbot-ui-62nj-*-jdmiamis-projects.vercel.app'].filter(Boolean).join(',');
  let lastError: Error | null = null;
  for (const gpu of e.gpuTypes) {
    try {
      return (await runpod('/pods', {
        method: 'POST',
        body: JSON.stringify({
          name: e.name,
          cloud: 'SECURE',
          gpu: { id: gpu, count: 1, minCudaVersion: '12.4' },
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
            IDLE_MINUTES: e.idleMinutes,
            DEFAULT_MODELS: e.models,
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
const noCapacity = (msg: string) => /not enough|no (gpu|longer)|insufficient|capacity|unavailable|free gpu/i.test(msg);

/** Turn the AI machine on: start it, create it, or replace it when its host has no free GPU. */
export async function startAi(): Promise<void> {
  const pod = await findAiPod();
  if (!pod) {
    await createAiPod();
    return;
  }
  if (pod.status === 'RUNNING' || pod.status === 'STARTING' || pod.status === 'PROVISIONING') return;
  try {
    await runpod(`/pods/${encodeURIComponent(pod.id)}/action`, { method: 'POST', body: JSON.stringify({ action: 'start' }) });
  } catch (err) {
    if (!noCapacity((err as Error).message) && pod.status !== 'ERROR') throw err;
    // Everything worth keeping is on the network volume, so a fresh pod picks up where it left off.
    await createAiPod();
    await runpod(`/pods/${encodeURIComponent(pod.id)}`, { method: 'DELETE' }).catch(() => {});
  }
}

export async function stopAi(): Promise<void> {
  const pod = await findAiPod();
  if (pod && pod.status !== 'EXITED') {
    await runpod(`/pods/${encodeURIComponent(pod.id)}/action`, { method: 'POST', body: JSON.stringify({ action: 'stop' }) });
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
  if (!pod) return { state: 'off', costPerHour: null };
  const cost = typeof pod.cost === 'number' && pod.cost > 0 ? pod.cost : null;
  switch (pod.status) {
    case 'EXITED':
      return { state: 'off', costPerHour: null, podId: pod.id };
    case 'PROVISIONING':
    case 'STARTING':
      return { state: 'starting', costPerHour: cost, podId: pod.id };
    case 'RUNNING':
      break;
    default:
      return { state: 'error', costPerHour: cost, podId: pod.id, detail: `Runpod reports status ${pod.status ?? 'unknown'}.` };
  }
  try {
    const res = await fetch(`${aiBase(pod.id)}/_orbit/status`, {
      headers: { authorization: `Bearer ${await aiToken(user, 'orbit-ai')}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { state: 'starting', costPerHour: cost, podId: pod.id };
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
    };
  } catch {
    return { state: 'starting', costPerHour: cost, podId: pod.id };
  }
}
