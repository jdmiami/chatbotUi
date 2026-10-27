import { AiError, type StudioJob, type StudioKind, type StudioRequest } from './LocalAi';

/**
 * The serverless AI machine (the site's /api/make/serverless): your own makers on a pay-per-second
 * GPU, for when the AI machine is off. A job is sent exactly as it would go to the AI machine; what
 * comes back lands in the gallery kept in cloud storage (the Gallery app). Jobs made this way carry
 * ids starting with "sl:" in Make's list, so they are followed here and never asked of the machine.
 */

export interface ServerlessInfo {
  configured: boolean;
  ready: boolean;
  pricePerHour: { from: number; to: number };
  /** Makers added on the AI machine (the built-in ones always work there too). */
  wanted: string[];
  note?: string;
}

export interface ServerlessJob {
  id: string;
  status: 'queued' | 'running' | 'done' | 'error' | 'stopped';
  progress: number;
  etaSeconds?: number | null;
  slow?: boolean;
  detail?: string | null;
  notes?: string[];
  error?: string | null;
  job?: Record<string, unknown> | null;
  waitedSeconds?: number;
  ranSeconds?: number;
}

const ENDPOINT = '/api/make/serverless';
export const SL = 'sl:';
export const isServerlessId = (id: string) => id.startsWith(SL);

async function call<T>(init?: RequestInit, query = ''): Promise<T> {
  const res = await fetch(ENDPOINT + query, { cache: 'no-store', credentials: 'same-origin', ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  if (!(res.headers.get('content-type') ?? '').includes('json')) throw new AiError('The serverless machine is only there when Orbit is opened from your workspace site.', res.status);
  const body = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new AiError(body.error ?? `The serverless machine answered ${res.status}.`, res.status);
  return body;
}

export async function serverlessInfo(): Promise<ServerlessInfo | null> {
  try {
    return await call<ServerlessInfo>();
  } catch {
    return null;
  }
}

/** Plain words for the price: GPU time by the second, only while a job runs. */
export function serverlessPriceWords(info: ServerlessInfo): string {
  const perMin = (h: number) => (h / 60).toFixed(2);
  return `about $${perMin(info.pricePerHour.from)}–${perMin(info.pricePerHour.to)} a minute of GPU time, only while it works`;
}

/** Which makers the serverless machine has: the built-in ones and those added on the AI machine. */
export function onServerless(info: ServerlessInfo | null, maker: { id: string; builtIn?: boolean } | null): boolean {
  if (!info?.ready) return false;
  if (!maker) return true;
  return Boolean(maker.builtIn) || info.wanted.includes(maker.id);
}

/** Start a job; the StudioJob Make shows for it (id "sl:<runpod id>"). */
export async function serverlessStart(req: StudioRequest): Promise<StudioJob> {
  const j = await call<ServerlessJob>({ method: 'POST', body: JSON.stringify({ job: req }) });
  return asStudioJob(j, req.kind, req.prompt ?? '', new Date().toISOString());
}

export async function serverlessJob(prev: StudioJob): Promise<StudioJob> {
  const j = await call<ServerlessJob>(undefined, `?id=${encodeURIComponent(prev.id.slice(SL.length))}`);
  return asStudioJob(j, prev.kind, prev.prompt, prev.createdAt);
}

export async function serverlessCancel(id: string): Promise<void> {
  await call({ method: 'DELETE' }, `?id=${encodeURIComponent(id.slice(SL.length))}`);
}

const WHERE = 'Made on a pay-per-second GPU (your AI machine is off).';

function asStudioJob(j: ServerlessJob, kind: StudioKind, prompt: string, createdAt: string): StudioJob {
  const gate = j.job ?? null;
  const notes = [WHERE, ...(j.detail ? [j.detail] : []), ...(j.notes ?? [])];
  const item = gate && gate.item && typeof gate.item === 'object' ? (gate.item as StudioJob['item']) : null;
  return {
    id: SL + j.id,
    kind,
    prompt: typeof gate?.prompt === 'string' && gate.prompt ? (gate.prompt as string) : prompt,
    status: j.status,
    progress: j.progress,
    error: j.error ?? null,
    createdAt,
    item,
    etaSeconds: j.etaSeconds ?? null,
    slow: j.slow,
    notes,
  };
}
