import 'server-only';
import { randomUUID } from 'node:crypto';
import { GPUAI_API } from './gpuai';
import { AUTO_TERMINATE_HOURS, DISK_GB, ONLY_MAKERS, STANDARD_GPUS, TURBO_GPUS, liveAddress, machineState, nextGpu, pickMachine, type GpuChoice, type GpuaiInstance, type MachineNote } from './gpuaiShared';
import { imageBuilt, imageFor } from './serverlessShared';
import { createR2, r2Config } from './r2';
import { autoOffMinutes } from './autoOff';

/**
 * The AI machine on GPU.ai (AI_PROVIDER=gpuai): an instance started from our own container image
 * (ghcr.io/jdmiami/orbit-ai-worker, the serverless worker's image) running ai/serverless/machine.sh:
 * ComfyUI and the gate in its helper role, making pictures and videos only, with just the makers in
 * ONLY_MAKERS (Qwen Image and H3 Max). Nothing is kept on the instance: models come down from R2 at
 * every start and the gallery goes to R2, so a terminated machine loses nothing.
 *
 * Its address is a tunnel the machine opens itself (a trycloudflare.com name that changes every
 * start), published in R2 (state/ai-machine.json) by the gate and read here. The machine asks the
 * site to terminate it when idle (POST /api/ai/off); GPU.ai terminates it after AUTO_TERMINATE_HOURS
 * whatever happens. The key (GPUAI_API_KEY) stays on the server.
 */

export const MACHINE_KEY = 'state/ai-machine.json';
const name = () => process.env.AI_POD_NAME || 'orbit-ai';

export async function gpuai(path: string, init: RequestInit = {}) {
  const key = process.env.GPUAI_API_KEY;
  if (!key) throw new Error('GPUAI_API_KEY is not set');
  const res = await fetch(`${GPUAI_API}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  if (!res.ok) throw Object.assign(new Error(`GPU.ai API ${res.status}: ${text.slice(0, 300)}`), { status: res.status, body: text });
  return text ? (JSON.parse(text) as unknown) : null;
}

/** The newest live instance named like the AI machine, or null. */
export async function findMachine(): Promise<GpuaiInstance | null> {
  const body = (await gpuai('/instances?limit=50')) as { data?: GpuaiInstance[] };
  return pickMachine(body.data ?? [], name());
}

export async function getMachine(id: string): Promise<GpuaiInstance | null> {
  try {
    return (await gpuai(`/instances/${encodeURIComponent(id)}`)) as GpuaiInstance;
  } catch (err) {
    if ((err as { status?: number }).status === 404) return null;
    throw err;
  }
}

/** The address the machine published, when it is the running instance's own and fresh. */
export async function machineAddress(instance: GpuaiInstance): Promise<string | null> {
  const conf = r2Config();
  if (!conf) return null;
  const note = await createR2(conf).getJson<MachineNote>(MACHINE_KEY).catch(() => null);
  return liveAddress(note, instance);
}

/** The worker image this deployment built (lib/serverlessMake.ts), else the newest. */
async function machineImage() {
  if (process.env.AI_WORKER_IMAGE) return process.env.AI_WORKER_IMAGE;
  const sha = process.env.VERCEL_GIT_COMMIT_SHA;
  return imageFor(sha, sha ? await imageBuilt(sha) : false);
}

/** What the instance runs with: the same secrets and settings as the AI machine on Runpod had, as plain values. */
function machineEnv(): Record<string, string> {
  const r2 = r2Config();
  const site = process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '';
  return {
    GATEWAY_SECRET: process.env.LINUX_GATEWAY_SECRET || '',
    SITE_URL: site,
    ALLOWED_ORIGINS: process.env.LINUX_ALLOWED_ORIGINS || [site, 'https://chatbot-ui-62nj-*-jdmiamis-projects.vercel.app'].filter(Boolean).join(','),
    IDLE_MINUTES: String(autoOffMinutes()),
    MACHINE_NAME: name(),
    ONLY_MAKERS: process.env.AI_ONLY_MAKERS || ONLY_MAKERS,
    ...(r2 ? { R2_ACCOUNT_ID: r2.accountId, R2_ACCESS_KEY_ID: r2.accessKeyId, R2_SECRET_ACCESS_KEY: r2.secretAccessKey, R2_BUCKET: r2.bucket } : {}),
    ...(process.env.HF_TOKEN ? { HF_TOKEN: process.env.HF_TOKEN } : {}),
  };
}

/** The GPUs a speed tries, cheapest first. */
export const gpusFor = (tier: 'standard' | 'turbo'): GpuChoice[] => (tier === 'turbo' ? TURBO_GPUS : STANDARD_GPUS);

/**
 * Start a machine: the first GPU of the speed that GPU.ai can place our image on. Returns the
 * operation's instance id once GPU.ai has accepted the request (the machine then takes minutes to
 * boot, bring the models down and open its tunnel).
 */
export async function createMachine(tier: 'standard' | 'turbo' = 'standard'): Promise<{ id: string | null; gpu: GpuChoice }> {
  const image = await machineImage();
  const env = machineEnv();
  if (!env.R2_ACCOUNT_ID) throw new Error('The site needs the R2 keys (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY) to start the AI machine.');
  let last: Error | null = null;
  const started = Date.now();
  for (const gpu of gpusFor(tier)) {
    if (Date.now() - started > 40_000) break;
    try {
      const op = (await gpuai('/instances', {
        method: 'POST',
        headers: { 'idempotency-key': randomUUID() },
        body: JSON.stringify({
          name: name(),
          gpu_type: gpu.gpu,
          gpu_count: 1,
          tier: 'on_demand',
          image,
          cmd: ['bash', '/opt/serverless/machine.sh'],
          env,
          // The gate on :8080, also at GPU.ai's own app address (a login page in front: a fallback for a person).
          ports: [{ port: 8080, protocol: 'http', primary: true }],
          disk_gb: DISK_GB,
          auto_terminate_hours: AUTO_TERMINATE_HOURS,
          // Never dearer than the catalog price shown (plus the disk beyond the included 100 GB).
          max_price_per_hour: Math.round((gpu.pricePerHour + 0.02) * 100) / 100,
        }),
      })) as { operation_id?: string; resource_id?: string | null };
      return { id: op.resource_id ?? null, gpu };
    } catch (err) {
      last = err as Error;
      const e = err as { status?: number; body?: string };
      if (!nextGpu(e.status ?? 0, e.body ?? '')) throw err;
    }
  }
  throw new Error(`No ${tier === 'turbo' ? 'Turbo' : 'Standard'} GPU is free on GPU.ai right now (${gpusFor(tier).map((g) => g.gpuName).join(', ')}). Try again in a few minutes.${last ? '' : ''}`);
}

export async function terminateMachine(id: string): Promise<void> {
  try {
    await gpuai(`/instances/${encodeURIComponent(id)}`, { method: 'DELETE' });
  } catch (err) {
    if ((err as { status?: number }).status !== 404) throw err;
  }
}

/** GPU.ai's balance, for the status pill: dollars left, and what the account burns an hour right now. */
export async function gpuaiBalance(): Promise<{ balance: number | null; spendPerHour: number | null }> {
  const b = (await gpuai('/billing/balance')) as { balance_dollars?: number; burn_cents_per_hour?: number };
  return {
    balance: typeof b.balance_dollars === 'number' ? b.balance_dollars : null,
    spendPerHour: typeof b.burn_cents_per_hour === 'number' ? b.burn_cents_per_hour / 100 : null,
  };
}

/** The machine's state from GPU.ai alone, with its address once the machine has published one. */
export async function machineView(): Promise<{ instance: GpuaiInstance | null; state: ReturnType<typeof machineState>; url: string | null }> {
  const instance = await findMachine();
  const state = machineState(instance);
  const url = instance && state === 'running' ? await machineAddress(instance) : null;
  return { instance, state, url };
}
