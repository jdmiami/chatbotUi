/**
 * The AI machine on GPU.ai, the parts with no secrets in them (tested in tests/site): which GPUs to
 * try and what they cost, what an instance's answer means to the site, and when the address the
 * machine published in R2 (ai/gate/src/announce.js) belongs to the instance that is running now.
 */

/** GPUs for the AI machine, cheapest first; all 48 GB or more, enough for Qwen Image and H3 Max. */
export interface GpuChoice {
  gpu: string;
  gpuName: string;
  pricePerHour: number;
}
export const STANDARD_GPUS: GpuChoice[] = [
  { gpu: 'rtx_a6000', gpuName: 'RTX A6000 48 GB', pricePerHour: 0.45 },
  { gpu: 'rtx_6000_ada', gpuName: 'RTX 6000 Ada 48 GB', pricePerHour: 0.65 },
  { gpu: 'l40', gpuName: 'L40 48 GB', pricePerHour: 0.78 },
  { gpu: 'l40s', gpuName: 'L40S 48 GB', pricePerHour: 0.8 },
];
export const TURBO_GPUS: GpuChoice[] = [
  { gpu: 'a100_80gb', gpuName: 'A100 80 GB', pricePerHour: 1.25 },
  { gpu: 'rtx_pro_6000', gpuName: 'RTX PRO 6000 96 GB', pricePerHour: 1.99 },
  { gpu: 'h100_pcie', gpuName: 'H100 80 GB', pricePerHour: 2.48 },
];
/** The makers this machine starts with (yours to pick from; nothing loads until you pick): Qwen Image, its edit, H3 Max. */
export const ONLY_MAKERS = 'qwen,edit,h3-max';
/** Your makers on this machine (the gate's own list in R2): what you added in the store. */
export const LIBRARY_KEY = 'state/makers-gpuai.json';
/** What you picked to load first while the machine was starting (the gate reads it when it comes up). */
export const FIRST_KEY = 'state/makers-gpuai-first.json';

/** Picks from Orbit, cleaned: maker ids only, no repeats, at most 20, in the order given. */
export function cleanPicks(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  const out: string[] = [];
  for (const id of ids) if (typeof id === 'string' && /^[a-z0-9][a-z0-9-]{0,39}$/.test(id) && !out.includes(id)) out.push(id);
  return out.slice(0, 20);
}

/** Your makers: the starting list, then what you added in the store (no repeats). */
export function libraryOf(only: string, saved: unknown): string[] {
  const added = saved && typeof saved === 'object' && Array.isArray((saved as { wanted?: unknown }).wanted) ? (saved as { wanted: unknown[] }).wanted : [];
  return cleanPicks([...only.split(',').map((s) => s.trim()), ...added]);
}

/** GPU.ai terminates the instance after this many hours whatever happens: the money fail-safe. */
export const AUTO_TERMINATE_HOURS = 8;
/** The instance's filesystem: Qwen Image (about 25 GB), H3 Max (about 52 GB), the maker's own files, room to work. */
export const DISK_GB = 150;

/** What GPU.ai says about an instance (GET /v1/instances/{id}), the fields the site reads. */
export interface GpuaiInstance {
  id: string;
  name?: string | null;
  status: 'allocating' | 'starting' | 'running' | 'stopping' | 'stopped' | 'terminated' | 'unreachable' | 'error' | string;
  gpu_type?: string;
  region?: string;
  price_per_hour?: number;
  created_at?: string;
  ready_at?: string | null;
  terminated_at?: string | null;
  status_reason?: string;
  auto_terminate_at?: string;
}

/** The note the machine publishes in R2 (state/ai-machine.json). */
export interface MachineNote {
  name: string;
  url: string;
  startedAt: string;
  at: string;
}

/** A note older than this is stale: the machine is gone or stuck (the gate refreshes it every minute). */
export const NOTE_STALE_MS = 3 * 60_000;
const TUNNEL = /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/;

/** Still counted as the live machine (not gone). */
export const isLive = (i: Pick<GpuaiInstance, 'status'>) => !['stopping', 'stopped', 'terminated', 'error'].includes(i.status);

/** The newest live instance with this name, or null. */
export function pickMachine(list: GpuaiInstance[], name: string): GpuaiInstance | null {
  const live = list.filter((i) => i.name === name && isLive(i));
  live.sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')));
  return live[0] ?? null;
}

/**
 * The address to use for this instance, or null: the note must carry the machine's name, a tunnel
 * address, a start after the instance was created (never an older machine's note), and a fresh heartbeat.
 */
export function liveAddress(note: Partial<MachineNote> | null | undefined, instance: GpuaiInstance, now = Date.now()): string | null {
  if (!note || typeof note.url !== 'string' || !TUNNEL.test(note.url)) return null;
  if (note.name !== instance.name) return null;
  const at = Date.parse(String(note.at));
  if (!Number.isFinite(at) || now - at > NOTE_STALE_MS) return null;
  const started = Date.parse(String(note.startedAt));
  const created = Date.parse(String(instance.created_at ?? ''));
  // A minute of slack: the instance's clock and ours need not agree to the second.
  if (Number.isFinite(created) && (!Number.isFinite(started) || started < created - 60_000)) return null;
  return note.url;
}

/** GPU.ai's status as the site's machine state (before asking the gate itself). */
export function machineState(i: GpuaiInstance | null): 'off' | 'starting' | 'running' | 'error' {
  if (!i || !isLive(i)) return 'off';
  if (i.status === 'running') return 'running';
  if (i.status === 'allocating' || i.status === 'starting') return 'starting';
  // 'unreachable': the machine is up but its tunnel to GPU.ai is down; our own tunnel may still work.
  if (i.status === 'unreachable') return 'running';
  return 'error';
}

/** One row of GPU.ai's price list (GET /v1/pricing), the fields the site reads. */
export interface Offering {
  gpu_type: string;
  gpu_count: number;
  tier: string;
  price_per_hour: number;
  available: number;
  instance_disk_gb: number;
  disk_configurable: boolean;
  offering_id: string;
  region?: string;
}

/**
 * The machine to start for one GPU type: the cheapest free single-GPU offering that has room for the
 * makers. A fixed disk must already be big enough (most machines: GPU.ai refuses a size there); a
 * configurable one is asked for DISK_GB. Null when no offering of that type fits.
 */
export function pickOffering(list: Offering[], gpu: string, diskGb = DISK_GB): { offering: Offering; diskGb: number | null } | null {
  const fits = list
    .filter((o) => o.gpu_type === gpu && o.gpu_count === 1 && o.tier === 'on_demand' && o.available > 0)
    .filter((o) => o.disk_configurable || o.instance_disk_gb >= diskGb)
    .sort((a, b) => a.price_per_hour - b.price_per_hour);
  const o = fits[0];
  if (!o) return null;
  return { offering: o, diskGb: o.disk_configurable && o.instance_disk_gb < diskGb ? diskGb : null };
}

/** GPU.ai's refusal of one GPU type (no capacity, image can't run there): try the next one. */
export const nextGpu = (status: number, body: string) =>
  status === 422 && /image_unavailable|no_capacity|capacity|unavailable|offering|disk_unavailable|disk_exceeds|environment_unavailable|price_changed/i.test(body);

/** An operation GPU.ai failed at once for a reason another machine may not have: try the next GPU. */
export const nextGpuAfterFailedOperation = (detail: string) => /disk|capacity|unavailable|offering|cannot be configured|no longer|sold out|price/i.test(detail);
