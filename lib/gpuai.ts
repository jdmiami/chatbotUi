/**
 * GPU.ai's hosted video maker, the parts with no secrets in them (tested in tests/site): MiniMax H3,
 * paid per second of finished video. The site sends a job (POST /v1/videos), asks after it, and
 * fetches the mp4 straight into the stored gallery (lib/gallery.ts, importCloudItem) with the key the
 * browser never sees. Kept free of `server-only` so the tests can load it; the key stays in cloudMake.ts.
 */

export const GPUAI_API = 'https://api.gpu.ai/v1';
export const GPUAI_HOST = 'api.gpu.ai';
/** The one video maker Make uses there. */
export const GPUAI_VIDEO_MODEL = 'gpuai/minimax-h3';
export const GPUAI_VIDEO_NAME = 'MiniMax H3';
/** What H3 accepts: a clip length in whole seconds (GET /v1/models/gpuai/minimax-h3). */
export const H3_SECONDS = { min: 1, max: 10, default: 5 } as const;
/** Its price, from the catalog: cents for each second of finished video (failed jobs cost nothing). */
export const H3_CENTS_PER_SECOND = 14;

/** A clip length H3 takes: whole seconds within its bounds (anything else becomes the default). */
export function h3Seconds(v: unknown): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < H3_SECONDS.min || n > H3_SECONDS.max) return H3_SECONDS.default;
  return n;
}

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;
/** The price in plain words: "about $0.70 for 5 seconds (14¢ a second)". */
export function h3Price(seconds: number = H3_SECONDS.default): string {
  return `about ${dollars(h3Seconds(seconds) * H3_CENTS_PER_SECOND)} for ${h3Seconds(seconds)} second${h3Seconds(seconds) === 1 ? '' : 's'} (${H3_CENTS_PER_SECOND}¢ a second)`;
}

/** GPU.ai's job ids: letters, digits, dashes, underscores (never a path someone else wrote). */
export const gpuaiJobId = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9_-]{6,120}$/.test(s);

/** Where a finished clip is fetched from (needs the key: the site fetches it, not the browser). */
export const gpuaiContentUrl = (jobId: string) => `${GPUAI_API}/videos/${encodeURIComponent(jobId)}/content`;

/** Is this a link to a finished clip on GPU.ai (the only thing of theirs the gallery will fetch)? */
export function isGpuaiContent(u: URL): boolean {
  return u.protocol === 'https:' && u.hostname === GPUAI_HOST && /^\/v1\/videos\/[A-Za-z0-9_-]{6,120}\/content$/.test(u.pathname);
}

export interface GpuaiVideoJob {
  id?: unknown;
  status?: unknown;
  progress?: unknown;
  cost_cents?: unknown;
  error?: unknown;
  failure_reason?: unknown;
}

export interface MappedVideoJob {
  status: 'queued' | 'running' | 'done' | 'error';
  /** 0–100 while it is being made (some models stay at 0 until the end). */
  progress?: number;
  /** What it cost, once known (cents). */
  costCents?: number;
  error?: string;
}

/** GPU.ai's answer for a video job (GET /v1/videos/<id>) as Make sees it. */
export function mapVideoJob(job: GpuaiVideoJob): MappedVideoJob {
  const status = String(job.status ?? '');
  const progress = Number.isFinite(Number(job.progress)) ? Math.max(0, Math.min(100, Math.round(Number(job.progress)))) : undefined;
  const costCents = Number.isFinite(Number(job.cost_cents)) ? Math.round(Number(job.cost_cents)) : undefined;
  if (status === 'queued') return { status: 'queued', progress, costCents };
  if (status === 'in_progress') return { status: 'running', progress, costCents };
  if (status === 'completed') return { status: 'done', progress: 100, costCents };
  if (status === 'cancelled') return { status: 'error', error: 'The video maker stopped this one.', costCents };
  if (status === 'expired') return { status: 'error', error: 'That video was not fetched in time and is gone. Make it again.', costCents };
  const why = reason(job);
  return { status: 'error', error: why ? `The video maker stopped: ${why}` : `The video maker stopped (${status.replace(/_/g, ' ') || 'unknown'}).`, costCents };
}

function reason(job: GpuaiVideoJob): string {
  const e = job.error as { message?: unknown } | string | undefined;
  const text = typeof e === 'string' ? e : typeof e?.message === 'string' ? e.message : typeof job.failure_reason === 'string' ? job.failure_reason : '';
  return text.trim().slice(0, 200);
}
