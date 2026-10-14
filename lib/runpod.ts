import 'server-only';

/**
 * Minimal Runpod REST v2 client for the one Linux machine (pod) this site controls.
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

/** https base URL of the services on the pod (gateway + Orbit host), via Runpod's HTTPS proxy. */
export function podHttpBase(): string | null {
  const id = podId();
  if (!id) return null;
  return `https://${id}-8080.proxy.runpod.net`;
}

async function runpod(path: string, init?: RequestInit) {
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

async function gatewayHealthy(): Promise<boolean> {
  const base = podHttpBase();
  if (!base) return false;
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
    const pod = (await runpod(`/pods/${encodeURIComponent(id)}`)) as { status?: PodStatus; cost?: number };
    // Runpod can report 0 for a stopped pod; show no price rather than a misleading "$0.00/hour".
    const cost = typeof pod.cost === 'number' && pod.cost > 0 ? pod.cost : null;
    switch (pod.status) {
      case 'RUNNING':
        return { state: (await gatewayHealthy()) ? 'on' : 'starting', costPerHour: cost, canControl };
      case 'PROVISIONING':
      case 'STARTING':
        return { state: 'starting', costPerHour: cost, canControl };
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

export async function setMachinePower(action: 'start' | 'stop'): Promise<void> {
  const id = podId();
  if (!id) throw new Error('LINUX_POD_ID is not set');
  await runpod(`/pods/${encodeURIComponent(id)}/action`, { method: 'POST', body: JSON.stringify({ action }) });
}
