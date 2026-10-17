import 'server-only';
import { SignJWT, jwtVerify } from 'jose';
import { aiBase, aiConsole, aiStatus, aiTiers, aiToken, findAiPod } from './ai';
import { podHttpBase, podId, runpod } from './runpod';

/**
 * Everything the status pill and task manager show, in one call: Runpod money (balance, spend per
 * hour, today's spend), both machines (state, cost, uptime, auto-off countdown, Runpod's live
 * readings) and each machine's own detail (processes, GPU memory users, disks, network).
 */

export interface MachineCard {
  id: 'ai' | 'linux';
  name: string;
  state: string;
  detail?: string;
  costPerHour: number | null;
  uptimeSeconds: number | null;
  /** AI machine: turns itself off at this time if unused. Linux machine: null (stays on). */
  offAt: string | null;
  autoOff: boolean;
  tier?: string | null;
  tiers?: { id: string; label: string; gpuName: string; pricePerHour: number }[];
  gpuName?: string | null;
  /** Runpod's own readings, in percent. */
  live: { cpu: number | null; memory: number | null; gpu: number | null; gpuMemory: number | null } | null;
  /** The machine's own report (sysstats.js + GPU users on the AI machine). */
  stats: unknown | null;
  consoleUrl?: string;
}

export interface Money {
  balance: number | null;
  spendPerHour: number | null;
  today: number | null;
  spendLimit: number | null;
}

const secret = () => new TextEncoder().encode(process.env.LINUX_GATEWAY_SECRET || '');

/** Island tokens are minted by the machines for the pill on their own pages (playground, VS Code). */
export async function islandUser(request: Request): Promise<string | null> {
  const h = request.headers.get('authorization') || '';
  if (!h.startsWith('Bearer ') || (process.env.LINUX_GATEWAY_SECRET || '').length < 32) return null;
  try {
    const { payload } = await jwtVerify(h.slice(7), secret(), { algorithms: ['HS256'], audience: 'site-island' });
    return payload.sub ?? 'owner';
  } catch {
    return null;
  }
}

/** The machines' pages call from their own addresses on Runpod's proxy. */
export function islandCors(request: Request): Record<string, string> {
  const origin = request.headers.get('origin') || '';
  if (!/^https:\/\/[a-z0-9]+-8080\.proxy\.runpod\.net$/.test(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    vary: 'Origin',
    'access-control-allow-headers': 'Authorization, Content-Type',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-max-age': '600',
  };
}

async function hostToken(user: string) {
  return new SignJWT({ scope: 'orbit' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user)
    .setIssuer('rdp-web')
    .setAudience('orbit-host')
    .setIssuedAt()
    .setExpirationTime('120s')
    .sign(secret());
}

async function getJson(url: string, token: string, ms = 5000) {
  try {
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` }, cache: 'no-store', signal: AbortSignal.timeout(ms) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

interface RunpodPod {
  id: string;
  status?: string;
  cost?: number;
  gpu?: { id?: string; count?: number } | null;
  runtime?: {
    uptime?: number;
    cpu?: { util?: number };
    memory?: { util?: number };
    gpus?: { util?: number; memoryUtil?: number }[];
  } | null;
}

function live(p: RunpodPod | null): MachineCard['live'] {
  const r = p?.runtime;
  if (!r) return null;
  const g = r.gpus?.[0];
  return { cpu: r.cpu?.util ?? null, memory: r.memory?.util ?? null, gpu: g?.util ?? null, gpuMemory: g?.memoryUtil ?? null };
}

type Myself = { data?: { myself?: { clientBalance?: number; currentSpendPerHr?: number; spendLimit?: number } } };

/** Balance and spend per hour (GraphQL). Bearer header first; older keys only work as ?api_key=. */
async function myself(key: string): Promise<Myself | null> {
  const query = JSON.stringify({ query: 'query { myself { clientBalance currentSpendPerHr spendLimit } }' });
  const ask = (url: string, headers: Record<string, string>) =>
    fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: query, cache: 'no-store', signal: AbortSignal.timeout(8000) })
      .then((r) => (r.ok ? (r.json() as Promise<Myself>) : null))
      .catch(() => null);
  const first = await ask('https://api.runpod.io/graphql', { authorization: `Bearer ${key}` });
  if (first?.data?.myself) return first;
  return ask(`https://api.runpod.io/graphql?api_key=${encodeURIComponent(key)}`, {});
}

// Money changes slowly and costs two Runpod calls: keep it for 30 seconds per server instance.
let moneyCache: { at: number; value: Money } | null = null;

export async function money(): Promise<Money | null> {
  const key = process.env.RUNPOD_API_KEY;
  if (!key) return null;
  if (moneyCache && Date.now() - moneyCache.at < 30_000) return moneyCache.value;
  const [me, bill] = await Promise.all([
    myself(key),
    runpod('/billing?bucketSize=day&lastN=1').catch(() => null) as Promise<{ records?: { totalAmount?: number }[]; metadata?: { totals?: { totalAmount?: number } } } | null>,
  ]);
  const m = me?.data?.myself;
  const value: Money = {
    balance: typeof m?.clientBalance === 'number' ? m.clientBalance : null,
    spendPerHour: typeof m?.currentSpendPerHr === 'number' ? m.currentSpendPerHr : null,
    today: bill?.metadata?.totals?.totalAmount ?? bill?.records?.[0]?.totalAmount ?? null,
    spendLimit: typeof m?.spendLimit === 'number' ? m.spendLimit : null,
  };
  moneyCache = { at: Date.now(), value };
  return value;
}

async function linuxCard(user: string, detail: boolean): Promise<MachineCard | null> {
  const id = podId();
  if (!id) return null;
  const pod = process.env.RUNPOD_API_KEY ? ((await runpod(`/pods/${encodeURIComponent(id)}`).catch(() => null)) as RunpodPod | null) : null;
  const running = pod ? pod.status === 'RUNNING' : true;
  const base = podHttpBase();
  const stats = detail && running && base ? await getJson(`${base}/orbit/api/stats`, await hostToken(user)) : null;
  const state = !pod ? (stats ? 'on' : 'unknown') : pod.status === 'RUNNING' ? 'on' : pod.status === 'EXITED' ? 'off' : pod.status === 'STARTING' || pod.status === 'PROVISIONING' ? 'starting' : 'error';
  return {
    id: 'linux',
    name: 'Linux machine',
    state,
    costPerHour: pod?.cost && pod.cost > 0 ? pod.cost : null,
    uptimeSeconds: running ? (pod?.runtime?.uptime ?? null) : null,
    offAt: null,
    autoOff: false,
    live: live(pod),
    stats,
    consoleUrl: `https://console.runpod.io/pods?id=${encodeURIComponent(id)}`,
  };
}

async function aiCard(user: string, detail: boolean): Promise<MachineCard | null> {
  const s = await aiStatus(user).catch(() => null);
  if (!s || s.state === 'unconfigured') return null;
  const pod = s.podId && process.env.RUNPOD_API_KEY ? ((await runpod(`/pods/${encodeURIComponent(s.podId)}`).catch(() => null)) as RunpodPod | null) : null;
  const on = s.state === 'on' || s.state === 'downloading';
  const stats = detail && on && s.podId ? ((await getJson(`${aiBase(s.podId)}/_orbit/stats`, await aiToken(user, 'orbit-ai'))) as { idle?: { offAt?: string } } | null) : null;
  const tier = aiTiers().find((t) => t.id === s.tier);
  return {
    id: 'ai',
    name: 'AI machine',
    state: s.state,
    detail: s.detail,
    costPerHour: s.costPerHour,
    uptimeSeconds: on || s.state === 'starting' ? (pod?.runtime?.uptime ?? null) : null,
    offAt: on ? (stats?.idle?.offAt ?? (s.idle ? new Date(Date.now() + (s.idle.limitMinutes - s.idle.idleMinutes) * 60_000).toISOString() : null)) : null,
    autoOff: true,
    tier: s.tier ?? null,
    tiers: aiTiers().map((t) => ({ id: t.id, label: t.label, gpuName: t.gpuName, pricePerHour: t.pricePerHour })),
    gpuName: tier?.gpuName ?? null,
    live: live(pod),
    stats,
    consoleUrl: s.podId ? aiConsole(s.podId) : undefined,
  };
}

/** `detail` = also ask each machine for its process list (the open task manager). */
export async function fullStatus(user: string, detail: boolean) {
  const [m, ai, linux] = await Promise.all([money(), aiCard(user, detail), linuxCard(user, detail)]);
  return { at: new Date().toISOString(), money: m, machines: [ai, linux].filter(Boolean) as MachineCard[] };
}

/** Actions that only reach the AI machine itself: keep it on longer, take a model out of GPU memory. */
export async function aiMachineAction(user: string, action: 'extend' | 'unload', arg: { minutes?: number; model?: string }) {
  const pod = await findAiPod();
  if (!pod || pod.status !== 'RUNNING') throw new Error('The AI machine is not on.');
  const token = await aiToken(user, 'orbit-ai');
  const path = action === 'extend' ? '/_orbit/keepawake' : '/_orbit/models/unload';
  const body = action === 'extend' ? { minutes: Math.min(240, Math.max(5, Number(arg.minutes) || 30)) } : { name: String(arg.model || '') };
  const res = await fetch(`${aiBase(pod.id)}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
    signal: AbortSignal.timeout(30_000),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || `The AI machine answered ${res.status}.`);
  return out;
}
