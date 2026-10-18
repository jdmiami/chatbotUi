import 'server-only';
import { runpod, podId as linuxPodId } from '@/lib/runpod';

/**
 * The outside fail-safe. Every few minutes (a GitHub Actions schedule, plus Vercel's daily cron) this
 * looks at every machine that is on and turns off the ones that should have turned themselves off:
 *  - no job (AI) or no input (Linux) for 20 minutes, with a 5-minute grace for the machine's own timer;
 *  - or the machine doesn't say how idle it is (broken or still on old code) and has been on for an hour.
 * It only ever stops machines, never starts or changes them, so it needs no sign-in.
 */

const LIMIT_MINUTES = 20;
const GRACE_MINUTES = 5;
const BLIND_LIMIT_MINUTES = 60;

interface Pod {
  id: string;
  name: string;
  status?: string;
  startedAt?: string;
  lastStartedAt?: string;
}

export interface WatchdogResult {
  at: string;
  machines: { name: string; status: string; idleMinutes: number | null; action: 'kept' | 'stopped' | 'stop failed'; why: string }[];
}

const aiName = () => process.env.AI_POD_NAME || 'orbit-ai';

async function idleMinutes(pod: Pod, linux: boolean): Promise<{ idle: number | null; heldUntil?: string | null }> {
  const url = `https://${pod.id}-8080.proxy.runpod.net${linux ? '/idle' : '/_orbit/idle'}`;
  try {
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(6000) });
    if (!res.ok) return { idle: null };
    const body = (await res.json()) as { idleMinutes?: number; heldUntil?: string | null };
    return typeof body.idleMinutes === 'number' ? { idle: body.idleMinutes, heldUntil: body.heldUntil } : { idle: null };
  } catch {
    return { idle: null };
  }
}

/** Decide for one running machine. Exported for tests. */
export function decide(
  idle: number | null,
  heldUntil: string | null | undefined,
  onForMinutes: number | null,
  now = Date.now(),
): { stop: boolean; why: string } {
  if (idle !== null) {
    if (heldUntil && Date.parse(heldUntil) > now) return { stop: false, why: `kept awake on request until ${heldUntil}` };
    if (idle >= LIMIT_MINUTES + GRACE_MINUTES) return { stop: true, why: `${idle} minutes without a job or input` };
    return { stop: false, why: `in use (${idle} min since the last job or input)` };
  }
  if (onForMinutes !== null && onForMinutes >= BLIND_LIMIT_MINUTES) {
    return { stop: true, why: `on for ${onForMinutes} minutes and not reporting how idle it is` };
  }
  return { stop: false, why: 'starting up, or not reporting yet' };
}

export async function runWatchdog(): Promise<WatchdogResult> {
  const body = (await runpod('/pods')) as { pods?: Pod[] } | Pod[];
  const pods = Array.isArray(body) ? body : (body.pods ?? []);
  const linuxId = linuxPodId();
  const ours = pods.filter((p) => p.id === linuxId || p.name === aiName() || p.name === `${aiName()}-helper`);
  const result: WatchdogResult = { at: new Date().toISOString(), machines: [] };
  for (const pod of ours) {
    const status = pod.status ?? 'unknown';
    const label = pod.id === linuxId ? 'Linux machine' : pod.name.endsWith('-helper') ? 'AI helper' : 'AI machine';
    if (status !== 'RUNNING') {
      result.machines.push({ name: label, status, idleMinutes: null, action: 'kept', why: status === 'EXITED' ? 'off' : 'not running' });
      continue;
    }
    const { idle, heldUntil } = await idleMinutes(pod, pod.id === linuxId);
    const started = Date.parse(pod.lastStartedAt || pod.startedAt || '');
    const onFor = Number.isFinite(started) ? Math.floor((Date.now() - started) / 60_000) : null;
    const d = decide(idle, heldUntil, onFor);
    if (!d.stop) {
      result.machines.push({ name: label, status, idleMinutes: idle, action: 'kept', why: d.why });
      continue;
    }
    try {
      await runpod(`/pods/${encodeURIComponent(pod.id)}/action`, { method: 'POST', body: JSON.stringify({ action: 'stop' }) });
      console.warn(`[watchdog] stopped ${label}: ${d.why}`);
      result.machines.push({ name: label, status, idleMinutes: idle, action: 'stopped', why: d.why });
    } catch (err) {
      console.error(`[watchdog] could not stop ${label}: ${(err as Error).message}`);
      result.machines.push({ name: label, status, idleMinutes: idle, action: 'stop failed', why: d.why });
    }
  }
  return result;
}
