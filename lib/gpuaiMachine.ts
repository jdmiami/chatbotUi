import 'server-only';
import { randomUUID } from 'node:crypto';
import { GPUAI_API } from './gpuai';
import { AUTO_TERMINATE_HOURS, DISK_FOR, FIRST_KEY, GPU_INFO, LIBRARY_KEY, NOTE_KEYS, ONLY_MAKERS, cleanPicks, gpuOptions, libraryOf, type MachineKind, STANDARD_GPUS, TURBO_GPUS, liveAddress, machineState, movedPrice, nextGpu, PRICE_SLACK, nextGpuAfterFailedOperation, pickMachine, pickOffering, type GpuChoice, type GpuaiInstance, type MachineNote, type Offering } from './gpuaiShared';
import { imageBuilt, imageFor } from './serverlessShared';
import { createR2, r2Config } from './r2';
import { autoOffMinutes } from './autoOff';

/**
 * The AI machine on GPU.ai (AI_PROVIDER=gpuai): an instance started from our own container image
 * (ghcr.io/jdmiami/orbit-ai-worker, the serverless worker's image) running ai/serverless/machine.sh:
 * ComfyUI and the gate in its helper role, making pictures and videos only. It loads nothing until you
 * pick (your makers: ONLY_MAKERS and what you added in the store); picks come down in order. Nothing is kept on the instance: models come down from R2 at
 * every start and the gallery goes to R2, so a terminated machine loses nothing.
 *
 * Its address is a tunnel the machine opens itself (a trycloudflare.com name that changes every
 * start), published in R2 (state/ai-machine.json) by the gate and read here. The machine asks the
 * site to terminate it when idle (POST /api/ai/off); GPU.ai terminates it after AUTO_TERMINATE_HOURS
 * whatever happens. The key (GPUAI_API_KEY) stays on the server.
 */

export const MACHINE_KEY = NOTE_KEYS.ai;
/** The AI machine is `orbit-ai`; the drawing machine (Live Draw) is `orbit-ai-canvas`. */
const name = (kind: MachineKind = 'ai') => `${process.env.AI_POD_NAME || 'orbit-ai'}${kind === 'canvas' ? '-canvas' : ''}`;

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
export async function findMachine(kind: MachineKind = 'ai'): Promise<GpuaiInstance | null> {
  const body = (await gpuai('/instances?limit=50')) as { data?: GpuaiInstance[] };
  return pickMachine(body.data ?? [], name(kind));
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
export async function machineAddress(instance: GpuaiInstance, kind: MachineKind = 'ai'): Promise<string | null> {
  const conf = r2Config();
  if (!conf) return null;
  const note = await createR2(conf).getJson<MachineNote>(NOTE_KEYS[kind]).catch(() => null);
  return liveAddress(note, instance);
}

/** Your makers on the machine, and what you picked to load first while it starts. */
export async function machinePicks(): Promise<{ library: string[]; first: string[] }> {
  const conf = r2Config();
  const only = process.env.AI_ONLY_MAKERS || ONLY_MAKERS;
  if (!conf) return { library: libraryOf(only, null), first: [] };
  const r2 = createR2(conf);
  const [saved, note] = await Promise.all([r2.getJson<unknown>(LIBRARY_KEY).catch(() => null), r2.getJson<{ ids?: unknown }>(FIRST_KEY).catch(() => null)]);
  const library = libraryOf(only, saved);
  return { library, first: cleanPicks(note?.ids) };
}

/** Save what to load first (in order); the machine reads it when it comes up. */
export async function setFirstPicks(ids: unknown): Promise<string[]> {
  const conf = r2Config();
  if (!conf) throw new Error('The site needs the R2 keys to remember what to load first.');
  // Any maker, not only yours: the machine skips an id it doesn't know.
  const first = cleanPicks(ids);
  await createR2(conf).putJson(FIRST_KEY, { ids: first, at: new Date().toISOString() });
  return first;
}

/** The worker image this deployment built (lib/serverlessMake.ts), else the newest. */
async function machineImage() {
  if (process.env.AI_WORKER_IMAGE) return process.env.AI_WORKER_IMAGE;
  const sha = process.env.VERCEL_GIT_COMMIT_SHA;
  return imageFor(sha, sha ? await imageBuilt(sha) : false);
}

/** What the instance runs with: the same secrets and settings as the AI machine on Runpod had, as plain values. */
function machineEnv(kind: MachineKind = 'ai'): Record<string, string> {
  const r2 = r2Config();
  const site = process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '';
  return {
    GATEWAY_SECRET: process.env.LINUX_GATEWAY_SECRET || '',
    SITE_URL: site,
    ALLOWED_ORIGINS: process.env.LINUX_ALLOWED_ORIGINS || [site, 'https://chatbot-ui-62nj-*-jdmiamis-projects.vercel.app'].filter(Boolean).join(','),
    IDLE_MINUTES: String(autoOffMinutes()),
    MACHINE_NAME: name(kind),
    // The drawing machine runs the gate's canvas role (Live Draw's engines); the AI machine its helper role.
    ...(kind === 'canvas' ? { MACHINE_ROLE: 'canvas' } : { ONLY_MAKERS: process.env.AI_ONLY_MAKERS || ONLY_MAKERS }),
    ...(r2 ? { R2_ACCOUNT_ID: r2.accountId, R2_ACCESS_KEY_ID: r2.accessKeyId, R2_SECRET_ACCESS_KEY: r2.secretAccessKey, R2_BUCKET: r2.bucket } : {}),
    ...(process.env.HF_TOKEN ? { HF_TOKEN: process.env.HF_TOKEN } : {}),
  };
}

/** The drawing machine's GPUs when none is picked: H100-class first (Bring to life needs it), cheapest first. */
const CANVAS_GPUS: GpuChoice[] = ['h200_nvl', 'h100_pcie', 'rtx_pro_6000', 'h100_sxm', 'h200_sxm'].map((gpu) => ({ gpu, gpuName: GPU_INFO[gpu]?.name ?? gpu, pricePerHour: 0 }));

/** The GPUs a speed tries, cheapest first. */
export const gpusFor = (tier: 'standard' | 'turbo'): GpuChoice[] => (tier === 'turbo' ? TURBO_GPUS : STANDARD_GPUS);

type Operation = { operation_id?: string; state?: string; resource_id?: string | null; error?: { code?: string; detail?: string } | null };

/** Every GPU to choose from right now for this machine (GPU.ai's live list), and the one to suggest. */
export async function machineGpuOptions(kind: MachineKind = 'ai') {
  return gpuOptions(await priceList(), kind);
}

/** GPU.ai's live price list (public, no key needed). */
async function priceList(): Promise<Offering[]> {
  const res = await fetch(`${GPUAI_API}/pricing`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`GPU.ai's price list answered ${res.status}`);
  return ((await res.json()) as { data?: Offering[] }).data ?? [];
}

/** Watch an operation for a few seconds: GPU.ai refuses some launches at once (a fixed disk, gone capacity). */
async function settle(op: Operation, ms = 8_000): Promise<Operation> {
  const until = Date.now() + ms;
  let cur = op;
  while (cur.operation_id && (cur.state === 'pending' || cur.state === 'in_progress') && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 1_500));
    cur = ((await gpuai(`/operations/${encodeURIComponent(cur.operation_id)}`).catch(() => cur)) as Operation) ?? cur;
  }
  return cur;
}

/**
 * Start a machine: for each GPU of the speed, cheapest first, the cheapest free machine with room for
 * the makers (pickOffering), pinned so GPU.ai never places a dearer one. Returns the instance id once
 * GPU.ai has accepted it (the machine then takes minutes to boot, bring the models down and open its tunnel).
 */
export async function createMachine(
  tier: 'standard' | 'turbo' = 'standard',
  { kind = 'ai', gpu: only }: { kind?: MachineKind; gpu?: string | null } = {},
): Promise<{ id: string | null; gpu: GpuChoice; pricePerHour: number }> {
  const image = await machineImage();
  const env = machineEnv(kind);
  const what = kind === 'canvas' ? 'the drawing machine' : 'the AI machine';
  if (!env.R2_ACCOUNT_ID) throw new Error(`The site needs the R2 keys (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY) to start ${what}.`);
  const prices = await priceList();
  // A new machine starts with nothing picked: picks from an earlier start don't carry over.
  if (kind === 'ai') await createR2(r2Config()!).putJson(FIRST_KEY, { ids: [], at: new Date().toISOString() }).catch(() => {});
  // The GPU you chose (only that one), else the speed's list, cheapest first.
  const choices: GpuChoice[] = only ? [{ gpu: only, gpuName: GPU_INFO[only]?.name ?? only, pricePerHour: 0 }] : kind === 'canvas' ? CANVAS_GPUS : gpusFor(tier);
  let lastWhy = '';
  const started = Date.now();
  for (const gpu of choices) {
    if (Date.now() - started > 40_000) break;
    const pick = pickOffering(prices, gpu.gpu, DISK_FOR[kind]);
    if (!pick) {
      if (only) throw new Error(`No ${gpu.gpuName} is free on GPU.ai right now. Pick another GPU.`);
      continue;
    }
    try {
      // The price GPU.ai checks includes the disk. If it moved by a few cents since the list was read
      // (it says so and launches nothing), launch once more at the new price; never for more than that.
      let viewed = pick.pricePerHour;
      for (let attempt = 0; ; attempt++) {
        const op = (await gpuai('/instances', {
          method: 'POST',
          headers: { 'idempotency-key': randomUUID() },
          body: JSON.stringify({
            name: name(kind),
            gpu_type: gpu.gpu,
            gpu_count: 1,
            tier: 'on_demand',
            offering_id: pick.offering.offering_id,
            image,
            cmd: ['bash', '/opt/serverless/machine.sh'],
            env,
            // The gate on :8080, also at GPU.ai's own app address (a login page in front: a fallback for a person).
            ports: [{ port: 8080, protocol: 'http', primary: true }],
            ...(pick.diskGb ? { disk_gb: pick.diskGb } : {}),
            auto_terminate_hours: AUTO_TERMINATE_HOURS,
            // Refused, not charged more, if the price moved since the list was read.
            viewed_price_per_hour: viewed,
            max_price_per_hour: Math.round((viewed + 0.05) * 100) / 100,
          }),
        })) as Operation;
        const done = await settle(op);
        if (done.state === 'failed' || done.state === 'cancelled') {
          lastWhy = done.error?.detail || done.error?.code || 'refused';
          const moved = movedPrice(lastWhy);
          if (attempt === 0 && moved !== null && moved > viewed && moved <= pick.pricePerHour + PRICE_SLACK) {
            viewed = moved;
            continue;
          }
          if (!only && nextGpuAfterFailedOperation(lastWhy)) break;
          throw new Error(`GPU.ai could not start ${what}${only ? ` on the ${gpu.gpuName}` : ''}: ${lastWhy}`);
        }
        return { id: done.resource_id ?? op.resource_id ?? null, gpu, pricePerHour: viewed };
      }
    } catch (err) {
      const e = err as { status?: number; body?: string };
      if (only || !e.status || !nextGpu(e.status, e.body ?? '')) throw err;
      lastWhy = (e.body ?? '').slice(0, 160);
    }
  }
  throw new Error(`No ${kind === 'canvas' ? 'drawing machine' : tier === 'turbo' ? 'Turbo' : 'Standard'} GPU is free on GPU.ai right now (${choices.map((g) => g.gpuName).join(', ')}). Try again in a few minutes, or pick another GPU.${lastWhy ? ` (${lastWhy})` : ''}`);
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
export async function machineView(kind: MachineKind = 'ai'): Promise<{ instance: GpuaiInstance | null; state: ReturnType<typeof machineState>; url: string | null }> {
  const instance = await findMachine(kind);
  const state = machineState(instance);
  const url = instance && state === 'running' ? await machineAddress(instance, kind) : null;
  return { instance, state, url };
}
