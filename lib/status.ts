import 'server-only';
import { SignJWT, jwtVerify } from 'jose';
import { aiBase, aiConsole, aiStatus, aiTiers, aiToken, findAiPod } from './ai';
import { linuxIdle, linuxKeepAwake, linuxSaveHome, podHttpBase, podId, runpod } from './runpod';
import { autoOffInfo, autoOffMinutes, keepOnMinutes } from './autoOff';

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
  /** Turns itself off at this time if unused (the machine's own timer, shared/autooff.js). */
  offAt: string | null;
  /** "Keep on" holds it on until this time, whatever the use. */
  heldUntil?: string | null;
  autoOff: boolean;
  /** The one auto-off rule's minutes (lib/autoOff.ts): the same for every machine. */
  autoOffMinutes: number;
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

/** Runpod network volumes ("saved storage"): $0.07 per GB a month (under 1 TB). */
export const VOLUME_PER_GB_MONTH = 0.07;

export interface SpendDay {
  date: string;
  amount: number;
  /** What the day's money went on. */
  gpu: number;
  cpu: number;
  disk: number;
  storage: number;
}

export interface SpendHistory {
  days: SpendDay[];
  total: number | null;
  volumes: { id: string; name: string; sizeGb: number; dataCenter: string | null; costPerMonth: number }[];
}

type BillingRecord = Record<string, unknown>;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);

/** Spend per day for the last `days` days, oldest first, and the drives that cost money while off. */
export async function spendHistory(days: number): Promise<SpendHistory> {
  if (!process.env.RUNPOD_API_KEY) return { days: [], total: null, volumes: [] };
  const [bill, vols] = await Promise.all([
    runpod(`/billing?bucketSize=day&lastN=${days}`).catch(() => null) as Promise<{ records?: BillingRecord[]; metadata?: { totals?: { totalAmount?: number } } } | BillingRecord[] | null>,
    runpod('/networkvolumes').catch(() => null) as Promise<{ id?: string; name?: string; size?: number; dataCenterId?: string }[] | null>,
  ]);
  const records = Array.isArray(bill) ? bill : bill?.records ?? [];
  const out: SpendDay[] = [];
  const sum = (r: BillingRecord, keys: string[]) => keys.reduce((t, k) => t + (num(r[k]) ?? 0), 0);
  for (const r of records) {
    const when = r.startTime ?? r.time ?? r.date;
    const amount = num(r.totalAmount) ?? num(r.amount);
    const at = typeof when === 'string' || typeof when === 'number' ? new Date(when) : null;
    if (!at || Number.isNaN(at.getTime()) || amount == null) continue;
    out.push({
      date: at.toISOString().slice(0, 10),
      amount,
      gpu: sum(r, ['podGpuAmount', 'serverlessGpuAmount', 'clusterGpuAmount']),
      cpu: sum(r, ['podCpuAmount', 'serverlessCpuAmount']),
      disk: sum(r, ['podDiskAmount', 'serverlessDiskAmount', 'clusterDiskAmount']),
      storage: sum(r, ['storageStandardAmount', 'storageHighPerformanceAmount']),
    });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  const total = Array.isArray(bill) ? null : num(bill?.metadata?.totals?.totalAmount);
  const volumes = (Array.isArray(vols) ? vols : []).map((v) => ({
    id: String(v.id ?? ''),
    name: String(v.name ?? 'Saved storage'),
    sizeGb: Number(v.size) || 0,
    dataCenter: v.dataCenterId ?? null,
    costPerMonth: (Number(v.size) || 0) * VOLUME_PER_GB_MONTH,
  }));
  return { days: out, total: total ?? (out.length ? out.reduce((t, d) => t + d.amount, 0) : null), volumes };
}

async function linuxCard(user: string, detail: boolean): Promise<MachineCard | null> {
  const id = podId();
  if (!id) return null;
  const pod = process.env.RUNPOD_API_KEY ? ((await runpod(`/pods/${encodeURIComponent(id)}`).catch(() => null)) as RunpodPod | null) : null;
  const running = pod ? pod.status === 'RUNNING' : true;
  const base = running ? await podHttpBase() : null;
  const [stats, idle] = await Promise.all([
    detail && base ? getJson(`${base}/orbit/api/stats`, await hostToken(user)) : null,
    base ? linuxIdle(base) : null,
  ]);
  const state = !pod ? (stats ? 'on' : 'unknown') : pod.status === 'RUNNING' ? 'on' : pod.status === 'EXITED' ? 'off' : pod.status === 'STARTING' || pod.status === 'PROVISIONING' ? 'starting' : 'error';
  return {
    id: 'linux',
    name: 'Linux machine',
    state,
    costPerHour: pod?.cost && pod.cost > 0 ? pod.cost : null,
    uptimeSeconds: running ? (pod?.runtime?.uptime ?? null) : null,
    offAt: state === 'on' ? (idle?.offAt ?? null) : null,
    heldUntil: state === 'on' ? (idle?.heldUntil ?? null) : null,
    autoOff: true,
    autoOffMinutes: autoOffMinutes(),
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
  const stats = detail && on && s.podId ? ((await getJson(`${aiBase(s.podId)}/_orbit/stats`, await aiToken(user, 'orbit-ai'))) as { idle?: { offAt?: string; heldUntil?: string | null } } | null) : null;
  const tier = aiTiers().find((t) => t.id === s.tier);
  return {
    id: 'ai',
    name: 'AI machine',
    state: s.state,
    detail: s.detail,
    costPerHour: s.costPerHour,
    uptimeSeconds: on || s.state === 'starting' ? (pod?.runtime?.uptime ?? null) : null,
    offAt: on ? (stats?.idle?.offAt ?? s.idle?.offAt ?? (s.idle ? new Date(Date.now() + (s.idle.limitMinutes - s.idle.idleMinutes) * 60_000).toISOString() : null)) : null,
    heldUntil: on ? (stats?.idle?.heldUntil ?? s.idle?.heldUntil ?? null) : null,
    autoOff: true,
    autoOffMinutes: autoOffMinutes(),
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
  return { at: new Date().toISOString(), money: m, autoOff: autoOffInfo(), machines: [ai, linux].filter(Boolean) as MachineCard[] };
}

/** Actions that only reach the AI machine itself: keep it on longer, take a model out of GPU memory. */
export async function aiMachineAction(user: string, action: 'extend' | 'unload', arg: { minutes?: number; model?: string }) {
  const pod = await findAiPod();
  if (!pod || pod.status !== 'RUNNING') throw new Error('The AI machine is not on.');
  const token = await aiToken(user, 'orbit-ai');
  const path = action === 'extend' ? '/_orbit/keepawake' : '/_orbit/models/unload';
  const body = action === 'extend' ? { minutes: keepOnMinutes(arg.minutes) } : { name: String(arg.model || '') };
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

/** Before the Linux machine is turned off: it saves its home to R2 (best effort, never throws). */
export async function linuxSaveBeforeStop(user: string): Promise<void> {
  if (!podId()) return;
  await linuxSaveHome(await hostToken(user)).catch(() => false);
}

/** "Keep on" for the Linux machine: the same rule and limits as the AI machine's. */
export async function linuxMachineExtend(user: string, minutes?: number) {
  if (!podId()) throw new Error('The Linux machine is not set up.');
  return linuxKeepAwake(await hostToken(user), keepOnMinutes(minutes));
}
