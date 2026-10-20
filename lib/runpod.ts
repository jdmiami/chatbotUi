import 'server-only';

/**
 * Minimal Runpod REST v2 client for the one Linux machine (pod) this site controls.
 *
 * The Linux machine keeps its files on a network volume, which ties it to one data center. When that
 * data center has no free machine, the site starts a stand-in ("fallback") pod with the same setup in
 * another US data center, without the volume, and points everything at it while it is on. The next
 * start tries the usual machine first again and removes the stand-in once the usual machine is back.
 * Docs: https://api.runpod.io/v2/openapi.json — GET /v2/pods/{id}, POST /v2/pods/{id}/action {action}.
 * The API key stays on the server (RUNPOD_API_KEY); the browser only sees the summarised state.
 */

const API = 'https://api.runpod.io/v2';

export type PodStatus = 'PROVISIONING' | 'STARTING' | 'RUNNING' | 'EXITED' | 'ERROR' | 'TERMINATED';

export type MachineState =
  | 'unconfigured' // no LINUX_POD_ID
  | 'off' // stopped: costs nothing per hour (saved storage still bills)
  | 'starting' // booting, or running but its setup hasn't finished yet
  | 'on' // running and the gateway answers
  | 'error'
  | 'unknown'; // no API key and the gateway doesn't answer, so we can't tell

export interface MachineStatus {
  state: MachineState;
  /** USD per hour while running, from Runpod. */
  costPerHour: number | null;
  /** Whether this site can start/stop the machine (needs RUNPOD_API_KEY). */
  canControl: boolean;
  detail?: string;
}

export function podId(): string | null {
  return process.env.LINUX_POD_ID || null;
}

const fallbackName = () => process.env.LINUX_FALLBACK_NAME || 'orbit-linux-fallback';
// US Secure Cloud data centers the stand-in may use, in order of preference (East first, near the usual one).
const US_DATA_CENTERS = 'US-NC-1,US-NC-2,US-PA-1,US-MD-1,US-GA-2,US-IL-1,US-MO-1,US-MO-2,US-KS-2,US-NE-1,US-TX-3,US-TX-4,US-CO-1,US-CA-2,US-WA-1,US-WA-2';
const ON: PodStatus[] = ['RUNNING', 'STARTING', 'PROVISIONING'];

interface Pod {
  id: string;
  name?: string;
  status?: PodStatus;
  cost?: number;
  dataCenterId?: string;
  image?: string;
  entrypoint?: string[];
  cmd?: string[];
  disk?: number;
  ports?: string[];
  env?: Record<string, string>;
  cpu?: { id?: string; vcpuCount?: number } | null;
}

async function findFallback(): Promise<Pod | null> {
  if (!process.env.RUNPOD_API_KEY) return null;
  const body = (await runpod('/pods').catch(() => null)) as { pods?: Pod[] } | Pod[] | null;
  const pods = Array.isArray(body) ? body : (body?.pods ?? []);
  return pods.find((p) => p.name === fallbackName() && p.status !== 'TERMINATED') ?? null;
}

/**
 * The pod to use right now: the stand-in while it is on and the usual machine isn't, otherwise the
 * usual machine.
 */
export async function activePodId(): Promise<string | null> {
  const id = podId();
  if (!id || !process.env.RUNPOD_API_KEY) return id;
  const main = (await runpod(`/pods/${encodeURIComponent(id)}`).catch(() => null)) as Pod | null;
  if (main?.status === 'RUNNING') return id;
  const fb = await findFallback();
  return fb && ON.includes(fb.status as PodStatus) ? fb.id : id;
}

const httpBase = (id: string) => `https://${id}-8080.proxy.runpod.net`;

/** https base URL of the services on the machine in use (gateway + Orbit host), via Runpod's HTTPS proxy. */
export async function podHttpBase(): Promise<string | null> {
  const id = await activePodId();
  return id ? httpBase(id) : null;
}

export async function runpod(path: string, init?: RequestInit) {
  const key = process.env.RUNPOD_API_KEY;
  if (!key) throw new Error('RUNPOD_API_KEY is not set');
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Runpod API ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.status === 204 ? null : res.json();
}

async function gatewayHealthy(id = podId()): Promise<boolean> {
  if (!id) return false;
  const base = httpBase(id);
  try {
    const res = await fetch(`${base}/healthz`, { cache: 'no-store', signal: AbortSignal.timeout(4_000) });
    return res.ok && (await res.text()).trim() === 'ok';
  } catch {
    return false;
  }
}

export async function machineStatus(): Promise<MachineStatus> {
  const id = podId();
  if (!id) return { state: 'unconfigured', costPerHour: null, canControl: false };
  const canControl = Boolean(process.env.RUNPOD_API_KEY);

  if (!canControl) {
    // Without an API key we can still tell whether it's up by asking the gateway.
    const up = await gatewayHealthy();
    return {
      state: up ? 'on' : 'unknown',
      costPerHour: null,
      canControl: false,
      detail: 'Add RUNPOD_API_KEY in Vercel to turn the machine on and off from here.',
    };
  }

  try {
    let pod = (await runpod(`/pods/${encodeURIComponent(id)}`)) as Pod;
    let note: string | undefined;
    if (pod.status !== 'RUNNING') {
      const fb = await findFallback();
      if (fb && ON.includes(fb.status as PodStatus)) {
        pod = fb;
        note = `Your usual Linux machine's data center had no free machine, so this is a stand-in in ${fb.dataCenterId ?? 'another US data center'}. Files from your saved drive aren't here, and what you save here is lost when it turns off.`;
      }
    }
    // Runpod can report 0 for a stopped pod; show no price rather than a misleading "$0.00/hour".
    const cost = typeof pod.cost === 'number' && pod.cost > 0 ? pod.cost : null;
    switch (pod.status) {
      case 'RUNNING':
        return { state: (await gatewayHealthy(pod.id)) ? 'on' : 'starting', costPerHour: cost, canControl, detail: note };
      case 'PROVISIONING':
      case 'STARTING':
        return { state: 'starting', costPerHour: cost, canControl, detail: note };
      case 'EXITED':
        return { state: 'off', costPerHour: cost, canControl };
      case 'TERMINATED':
        return { state: 'error', costPerHour: cost, canControl, detail: 'This machine was deleted on Runpod.' };
      default:
        return { state: 'error', costPerHour: cost, canControl, detail: `Runpod reports status ${pod.status ?? 'unknown'}.` };
    }
  } catch (err) {
    return { state: 'error', costPerHour: null, canControl, detail: (err as Error).message };
  }
}

/** Runpod says the machine's host or data center has nothing free right now. */
const noCapacity = (msg: string) =>
  /not enough|no (gpu|cpu|longer|instances?|machines?)|insufficient|capacity|unavailable|not available|free (gpu|cpu)/i.test(msg);

const action = (id: string, a: 'start' | 'stop') => runpod(`/pods/${encodeURIComponent(id)}/action`, { method: 'POST', body: JSON.stringify({ action: a }) });

/** A stand-in Linux machine like `main` (same image, setup and secrets) in any US data center, without the volume. */
async function createFallback(main: Pod): Promise<void> {
  const flavors = [...new Set([main.cpu?.id || 'cpu3g', 'cpu3g', 'cpu3c', 'cpu5c'])];
  let last: Error | null = null;
  for (const id of flavors) {
    try {
      await runpod('/pods', {
        method: 'POST',
        body: JSON.stringify({
          name: fallbackName(),
          cloud: 'SECURE',
          cpu: { id, vcpuCount: main.cpu?.vcpuCount || 2 },
          dataCenterIds: (process.env.LINUX_FALLBACK_DATA_CENTERS || US_DATA_CENTERS).split(',').map((s) => s.trim()).filter(Boolean),
          image: main.image,
          entrypoint: main.entrypoint,
          cmd: main.cmd,
          disk: main.disk || 20,
          ports: main.ports?.length ? main.ports : ['8080/http'],
          env: main.env ?? {},
        }),
      });
      return;
    } catch (err) {
      last = err as Error;
    }
  }
  throw new Error(`Your Linux machine's data center is full and no stand-in could be started anywhere in the US either: ${last?.message ?? 'unknown error'}. Try again in a few minutes.`);
}

async function startFallback(main: Pod): Promise<void> {
  const fb = await findFallback();
  if (fb && ON.includes(fb.status as PodStatus)) return;
  if (fb) {
    try {
      await action(fb.id, 'start');
      return;
    } catch {
      // Its host is full too: replace it (it holds nothing worth keeping).
      await runpod(`/pods/${encodeURIComponent(fb.id)}`, { method: 'DELETE' }).catch(() => {});
    }
  }
  await createFallback(main);
}

export async function setMachinePower(want: 'start' | 'stop'): Promise<void> {
  const id = podId();
  if (!id) throw new Error('LINUX_POD_ID is not set');
  if (want === 'stop') {
    const fb = await findFallback();
    if (fb && ON.includes(fb.status as PodStatus)) await action(fb.id, 'stop').catch(() => {});
    const main = (await runpod(`/pods/${encodeURIComponent(id)}`).catch(() => null)) as Pod | null;
    if (!main || ON.includes(main.status as PodStatus)) await action(id, 'stop');
    return;
  }
  let main = (await runpod(`/pods/${encodeURIComponent(id)}`).catch(() => null)) as Pod | null;
  if (process.env.VERCEL_GIT_COMMIT_SHA && main?.env) {
    // Start on this deployment's code, so fixes (like the idle shut-off) reach the machine.
    const repoRaw = `https://raw.githubusercontent.com/jdmiami/chatbotUi/${process.env.VERCEL_GIT_COMMIT_SHA}`;
    if (main.env.REPO_RAW !== repoRaw || main.env.IDLE_MINUTES !== '60') {
      const env = { ...main.env, REPO_RAW: repoRaw, IDLE_MINUTES: '60' };
      await runpod(`/pods/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ env }) }).catch(() => {});
      main = { ...main, env };
    }
  }
  if (main && ON.includes(main.status as PodStatus)) return;
  try {
    await action(id, 'start');
  } catch (err) {
    if (!main || !noCapacity((err as Error).message)) throw err;
    // The usual machine's data center is full: start a stand-in elsewhere in the US.
    await startFallback(main);
    return;
  }
  // The usual machine is back: the stand-in (if any, and not in use) is no longer needed.
  const fb = await findFallback();
  if (fb && !ON.includes(fb.status as PodStatus)) await runpod(`/pods/${encodeURIComponent(fb.id)}`, { method: 'DELETE' }).catch(() => {});
}
