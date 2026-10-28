/**
 * The serverless AI machine, the parts with no secrets in them (tested in tests/site): how a Runpod
 * job's status becomes what Make shows, and which image the endpoint should run.
 */

export type ServerlessStatus = 'queued' | 'running' | 'done' | 'error' | 'stopped';

/** One job on the serverless AI machine, as Make sees it. */
export interface ServerlessJob {
  id: string;
  status: ServerlessStatus;
  /** 0–100 while it is being made. */
  progress: number;
  etaSeconds?: number | null;
  slow?: boolean;
  /** What the worker is doing before the job itself runs (starting, getting files). */
  detail?: string | null;
  notes?: string[];
  error?: string | null;
  /** The gate's own job record once it has one (its item is in the gallery kept in cloud storage). */
  job?: Record<string, unknown> | null;
  /** Seconds the job waited for a worker, and seconds it ran (Runpod's figures). */
  waitedSeconds?: number;
  ranSeconds?: number;
}

/** The container image the endpoint runs: this deployment's own build when it exists, else the newest. */
export const WORKER_IMAGE = 'ghcr.io/jdmiami/orbit-ai-worker';
export const imageFor = (sha: string | undefined, built: boolean) => `${WORKER_IMAGE}:${sha && built ? sha : 'main'}`;

/**
 * The image the endpoint should run next, given what it runs now. Changing the image makes a release
 * (every worker is replaced, a picture being made on one is lost), so it only changes for this
 * deployment's own build once that is published. In the minutes between a deploy and its image build
 * the endpoint keeps the build it has rather than stepping to the newest and back again.
 */
export function nextImage(current: string | undefined, sha: string | undefined, built: boolean): string {
  if (sha && built) return imageFor(sha, true);
  if (current && current.startsWith(`${WORKER_IMAGE}:`)) return current;
  return imageFor(sha, false);
}

/** Runpod's answer for a job (POST /run, GET /status/<id>) turned into a ServerlessJob. */
export function mapStatus(id: string, st: Record<string, unknown>): ServerlessJob {
  const status = String(st.status ?? '');
  const out = (st.output && typeof st.output === 'object' ? st.output : {}) as Record<string, unknown>;
  const timing = { waitedSeconds: secs(st.delayTime), ranSeconds: secs(st.executionTime) };
  const notes = Array.isArray(out.notes) ? out.notes.filter((n): n is string => typeof n === 'string') : [];
  if (status === 'IN_QUEUE') return { id, status: 'queued', progress: 0, detail: 'Waiting for a GPU', ...timing };
  if (status === 'IN_PROGRESS') {
    // The worker's own progress (handler.py): starting, downloading, or the gate's job.
    const phase = String(out.status ?? '');
    const detail = typeof out.detail === 'string' ? out.detail : phase === 'queued' ? 'Starting the job' : null;
    return { id, status: 'running', progress: num(out.progress), etaSeconds: out.etaSeconds == null ? null : num(out.etaSeconds), slow: Boolean(out.slow), detail, notes, ...timing };
  }
  if (status === 'COMPLETED') {
    const job = out.job && typeof out.job === 'object' ? (out.job as Record<string, unknown>) : null;
    if (typeof out.error === 'string' && out.error) return { id, status: 'error', progress: 0, error: out.error, job, notes, ...timing };
    return { id, status: 'done', progress: 100, job, notes: Array.isArray(job?.notes) ? (job!.notes as string[]) : notes, ...timing };
  }
  if (status === 'CANCELLED') return { id, status: 'stopped', progress: 0, ...timing };
  if (status === 'FAILED' || status === 'TIMED_OUT') {
    const job = out.job && typeof out.job === 'object' ? (out.job as Record<string, unknown>) : null;
    const why = typeof out.error === 'string' && out.error ? out.error : typeof st.error === 'string' && st.error ? st.error : '';
    return { id, status: 'error', progress: 0, error: status === 'TIMED_OUT' ? 'That took too long and was stopped.' : plain(why), job, notes, ...timing };
  }
  return { id, status: 'error', progress: 0, error: `The serverless machine answered ${status || 'nothing'}.`, ...timing };
}

/** Runpod's own error strings are for engineers; keep what helps and say the rest plainly. */
function plain(why: string): string {
  const w = why.trim();
  if (!w) return 'That did not finish on the serverless machine.';
  if (/out of memory|CUDA|OOM/i.test(w)) return 'The GPU ran out of memory on that one. Try a smaller size or fewer seconds.';
  if (/^The maker|^That |^Add |^Swap |^There is no|^Turn |is not added/i.test(w)) return w.slice(0, 300);
  return `That did not finish on the serverless machine: ${w.slice(0, 200)}`;
}

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(100, Math.round(Number(v)))) : 0);
const secs = (ms: unknown) => (Number.isFinite(Number(ms)) ? Math.round(Number(ms) / 1000) : undefined);

/** What a job must not carry to the serverless machine: files that only ever lived on the AI machine. */
export function serverlessRefusal(job: Record<string, unknown>): string | null {
  if (job.videoUpload || job.audioUpload) return 'A video or sound you upload needs your AI machine on. Videos from your gallery work here.';
  return null;
}
