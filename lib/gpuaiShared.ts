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
/** The makers this machine loads, in download order: Qwen Image (and its edit), then H3 Max (turbo). */
export const ONLY_MAKERS = 'qwen,edit,h3-max';
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

/** GPU.ai's refusal of one GPU type (no capacity, image can't run there): try the next one. */
export const nextGpu = (status: number, body: string) =>
  status === 422 && /image_unavailable|no_capacity|capacity|unavailable|offering|disk_unavailable|environment_unavailable/i.test(body);
