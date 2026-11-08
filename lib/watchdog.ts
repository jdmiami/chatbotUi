import 'server-only';
import { runpod, podId as linuxPodId } from '@/lib/runpod';
import { autoOffMinutes, BLIND_LIMIT_MINUTES, GRACE_MINUTES } from '@/lib/autoOff';
import { findMachine, machineAddress, terminateMachine } from '@/lib/gpuaiMachine';
import { machineState } from '@/lib/gpuaiShared';

/**
 * The outside fail-safe. Every few minutes (a GitHub Actions schedule, plus Vercel's daily cron) this
 * looks at every machine that is on and turns off the ones that should have turned themselves off,
 * by the same rule for every machine (lib/autoOff.ts):
 *  - no job (AI) or no input (Linux) for autoOffMinutes(), plus a grace for the machine's own timer;
 *  - or the machine doesn't say how idle it is (broken or still on old code) and has been on for
 *    BLIND_LIMIT_MINUTES.
 * "Keep on" (heldUntil) is honoured. It only ever stops machines, never starts or changes them, so it
 * needs no sign-in.
 */

interface Pod {
  id: string;
  name: string;
  status?: string;
  /** Container uptime while running (Runpod's spellings vary). `startedAt` is not used: it can hold the creation time. */
  runtime?: { uptime?: number; uptimeInSeconds?: number; uptimeSeconds?: number } | null;
  uptimeSeconds?: number;
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
  limitMinutes = autoOffMinutes(),
): { stop: boolean; why: string } {
  if (idle !== null) {
    if (heldUntil && Date.parse(heldUntil) > now) return { stop: false, why: `kept on by request until ${heldUntil}` };
    if (idle >= limitMinutes + GRACE_MINUTES) return { stop: true, why: `${idle} minutes without a job or input` };
    return { stop: false, why: `in use (${idle} min since the last job or input)` };
  }
  if (onForMinutes !== null && onForMinutes >= BLIND_LIMIT_MINUTES) {
    return { stop: true, why: `on for ${onForMinutes} minutes and not reporting how idle it is` };
  }
  return { stop: false, why: 'starting up, or not reporting yet' };
}

/** The AI machine on GPU.ai: the same rule, read through its tunnel address; a stop is a terminate there. */
async function gpuaiWatchdog(): Promise<WatchdogResult> {
  const result: WatchdogResult = { at: new Date().toISOString(), machines: [] };
  // Both machines on GPU.ai: the AI machine and the drawing machine (Live Draw), each by the same rule.
  for (const [kind, label] of [['ai', 'AI machine'], ['canvas', 'Drawing machine']] as const) {
    const m = await findMachine(kind);
    const state = machineState(m);
    if (!m || state === 'off') {
      result.machines.push({ name: label, status: m?.status ?? 'off', idleMinutes: null, action: 'kept', why: 'off' });
      continue;
    }
    const url = state === 'running' ? await machineAddress(m, kind) : null;
    let idle: number | null = null;
    let heldUntil: string | null | undefined;
    if (url) {
      try {
        const res = await fetch(`${url}/_orbit/idle`, { cache: 'no-store', signal: AbortSignal.timeout(6000) });
        const body = res.ok ? ((await res.json()) as { idleMinutes?: number; heldUntil?: string | null }) : null;
        if (typeof body?.idleMinutes === 'number') ({ idleMinutes: idle, heldUntil } = body as { idleMinutes: number; heldUntil?: string | null });
      } catch {
        /* not answering: the blind limit below applies */
      }
    }
    const since = Date.parse(String(m.ready_at ?? m.created_at ?? ''));
    const onFor = Number.isFinite(since) ? Math.floor((Date.now() - since) / 60_000) : null;
    const d = decide(idle, heldUntil, onFor);
    if (!d.stop) {
      result.machines.push({ name: label, status: m.status, idleMinutes: idle, action: 'kept', why: d.why });
      continue;
    }
    try {
      await terminateMachine(m.id);
      console.warn(`[watchdog] stopped the ${label} on GPU.ai: ${d.why}`);
      result.machines.push({ name: label, status: m.status, idleMinutes: idle, action: 'stopped', why: d.why });
    } catch (err) {
      console.error(`[watchdog] could not stop the ${label} on GPU.ai: ${(err as Error).message}`);
      result.machines.push({ name: label, status: m.status, idleMinutes: idle, action: 'stop failed', why: d.why });
    }
  }
  return result;
}

/**
 * Every provider that has a key is looked at, so a machine turned on at either one is covered. One
 * provider failing to answer never hides the other's machines (it is listed, and the run still
 * fails only when none could be read).
 */
export async function runWatchdog(): Promise<WatchdogResult> {
  const checks: [string, () => Promise<WatchdogResult>][] = [];
  if (process.env.GPUAI_API_KEY) checks.push(['GPU.ai', gpuaiWatchdog]);
  if (process.env.RUNPOD_API_KEY) checks.push(['Runpod', runpodWatchdog]);
  const result: WatchdogResult = { at: new Date().toISOString(), machines: [] };
  const errors: Error[] = [];
  for (const [name, run] of checks) {
    try {
      result.machines.push(...(await run()).machines);
    } catch (err) {
      errors.push(err as Error);
      console.error(`[watchdog] could not read ${name}: ${(err as Error).message}`);
      result.machines.push({ name: `${name} (could not be read)`, status: 'unknown', idleMinutes: null, action: 'kept', why: (err as Error).message.slice(0, 200) });
    }
  }
  if (checks.length && errors.length === checks.length) throw errors[0];
  return result;
}

async function runpodWatchdog(): Promise<WatchdogResult> {
  const body = (await runpod('/pods')) as { pods?: Pod[] } | Pod[];
  const pods = Array.isArray(body) ? body : (body.pods ?? []);
  const linuxId = linuxPodId();
  const fallback = process.env.LINUX_FALLBACK_NAME || 'orbit-linux-fallback';
  const isLinux = (p: Pod) => p.id === linuxId || p.name === fallback;
  // The AI machine, its helper and the drawing machine (Live Draw) all run the same gate, with /_orbit/idle.
  const ours = pods.filter((p) => isLinux(p) || [aiName(), `${aiName()}-helper`, `${aiName()}-canvas`].includes(p.name));
  const result: WatchdogResult = { at: new Date().toISOString(), machines: [] };
  for (const pod of ours) {
    const status = pod.status ?? 'unknown';
    const label =
      pod.id === linuxId
        ? 'Linux machine'
        : pod.name === fallback
          ? 'Linux stand-in'
          : pod.name.endsWith('-helper')
            ? 'AI helper'
            : pod.name.endsWith('-canvas')
              ? 'Drawing machine'
              : 'AI machine';
    if (status !== 'RUNNING') {
      result.machines.push({ name: label, status, idleMinutes: null, action: 'kept', why: status === 'EXITED' ? 'off' : 'not running' });
      continue;
    }
    const { idle, heldUntil } = await idleMinutes(pod, isLinux(pod));
    // Unknown uptime never leads to a stop on its own: the machine's own timer still applies.
    const up = pod.runtime?.uptime ?? pod.runtime?.uptimeInSeconds ?? pod.runtime?.uptimeSeconds ?? pod.uptimeSeconds;
    const onFor = typeof up === 'number' && up >= 0 ? Math.floor(up / 60) : null;
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
