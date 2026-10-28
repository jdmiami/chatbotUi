import 'server-only';
import { runpod } from './runpod';
import { env, hfTokenEnv, r2SecretEnv, siteUrl } from './ai';
import { createR2, r2Config } from './r2';
import { autoOffMinutes } from './autoOff';
import { mapStatus, nextImage, serverlessRefusal, WORKER_IMAGE, type ServerlessJob } from './serverlessShared';

/**
 * The serverless AI machine: your own makers (the uncensored ones on the AI machine) on Runpod's
 * pay-per-second GPUs, for when the AI machine is off. A Runpod serverless endpoint runs the worker
 * container (ai/serverless), which holds the same ComfyUI and gate as the AI machine; model files live
 * on a Runpod network volume (synced from R2 the first time), and results land in the gallery kept
 * in R2, so the Gallery app shows them at once. Billed by the second only while a job runs, plus the
 * volume's storage. Runpod's key stays here on the server.
 *
 * Set up with: RUNPOD_API_KEY (as for the AI machine) and a drive for the models: the drawing machine's
 * global volume (CANVAS_GLOBAL_VOLUME_ID: works in any data center, its model folder is shared) or
 * AI_SERVERLESS_GLOBAL_VOLUME_ID, else a network volume (AI_SERVERLESS_VOLUME_ID; its data center fixes
 * where workers run). The endpoint itself is found by name (AI_POD_NAME + "-serverless") or made when
 * missing; AI_SERVERLESS_ENDPOINT pins one. AI_SERVERLESS=off turns it off. The image: this deployment's
 * build of the worker (ghcr.io/jdmiami/orbit-ai-worker:<commit>, .github/workflows/worker.yml), or the
 * newest when that build isn't there yet.
 */

/** The GPU pools workers may use (list-gpu-types `pool`): the 48 GB cards the AI machine's Standard speed uses, then the newer 48 GB cards. */
export const POOLS = ['AMPERE_48', 'ADA_48_PRO'];
/** Per hour of GPU time, billed by the second (Runpod's serverless rates for those pools). */
export const PRICE_PER_HOUR = { from: 1.22, to: 1.75 };
/**
 * How long a worker stays up after a job, billed. Loading a maker from the drive takes minutes (about
 * 100 MB/s: 3 min for a picture maker, 7+ for a video one), so a few minutes of warm waiting lets the
 * next picture in a row start at once instead of paying that load again.
 */
export const IDLE_SECONDS = 300;

const RP_JOBS = 'https://api.runpod.ai/v2/';
const endpointName = () => `${env().name}-serverless`;

export class ServerlessError extends Error {
  constructor(
    message: string,
    public status = 502,
  ) {
    super(message);
  }
}

/** The drive the models live on: a global volume (any data center) or a network volume (one data center). */
export function modelDrive(): { global: string } | { network: string } | null {
  const g = process.env.AI_SERVERLESS_GLOBAL_VOLUME_ID || process.env.CANVAS_GLOBAL_VOLUME_ID;
  if (g) return { global: g };
  return process.env.AI_SERVERLESS_VOLUME_ID ? { network: process.env.AI_SERVERLESS_VOLUME_ID } : null;
}

export function serverlessConfigured(): boolean {
  if (process.env.AI_SERVERLESS === 'off') return false;
  return Boolean(process.env.RUNPOD_API_KEY && env().secret.length >= 32 && (modelDrive() || process.env.AI_SERVERLESS_ENDPOINT));
}

interface Endpoint {
  id: string;
  name?: string;
  image?: string;
  env?: Record<string, string>;
  workers?: { min?: number; max?: number; idleTimeout?: number };
}

const listEndpoints = async (): Promise<Endpoint[]> => {
  const body = (await runpod('/serverless')) as { endpoints?: Endpoint[]; items?: Endpoint[] } | Endpoint[];
  return Array.isArray(body) ? body : (body.endpoints ?? body.items ?? []);
};

/** What the workers run with: the same secrets and settings as the AI machine (helper role). */
function workerEnv(): Record<string, string> {
  return {
    GATEWAY_SECRET: env().secret,
    SITE_URL: siteUrl(),
    IDLE_MINUTES: String(autoOffMinutes()),
    ...r2SecretEnv(),
    ...hfTokenEnv(),
  };
}

let cached: { at: number; endpoint: Endpoint | null } | null = null;

/** The endpoint, found by id or name, or made (when the volume is set); null when it can't be. */
export async function ensureEndpoint(): Promise<Endpoint | null> {
  if (!serverlessConfigured()) return null;
  if (cached && Date.now() - cached.at < 5 * 60_000 && cached.endpoint) return cached.endpoint;
  let ep: Endpoint | null = null;
  const pinned = process.env.AI_SERVERLESS_ENDPOINT;
  if (pinned) ep = (await runpod(`/serverless/${encodeURIComponent(pinned)}`).catch(() => null)) as Endpoint | null;
  if (!ep) ep = (await listEndpoints().catch(() => [])).find((e) => e.name === endpointName()) ?? null;
  const drive = modelDrive();
  if (!ep && drive) {
    ep = (await runpod('/serverless', {
      method: 'POST',
      body: JSON.stringify({
        name: endpointName(),
        type: 'QUEUE',
        scaling: { type: 'QUEUE_DELAY', queueDelay: 4 },
        gpu: { pools: POOLS, count: 1, minCudaVersion: '12.8' },
        image: await desiredImage(),
        // Outputs, inputs, ComfyUI's temp files, and one model file at a time on its way to the drive.
        disk: 80,
        env: workerEnv(),
        // One worker: two at once would write the same drive (model downloads) at the same time.
        workers: { min: 0, max: 1, idleTimeout: IDLE_SECONDS },
        flashboot: 'FLASHBOOT',
        // A job may first bring a maker's files onto the drive (tens of GB), then make a video.
        timeout: 2 * 3600_000,
        mounts: 'global' in drive ? { global: [{ volumeId: drive.global }] } : { network: [{ volumeId: drive.network }] },
      }),
    })) as Endpoint;
  }
  if (ep) await syncImage(ep).catch(() => {});
  cached = { at: Date.now(), endpoint: ep };
  return ep;
}

/** Is this deployment's worker image published yet (the registry answers without a key: the package is public)? */
async function imageBuilt(sha: string): Promise<boolean> {
  try {
    const repo = WORKER_IMAGE.replace(/^ghcr\.io\//, '');
    const t = (await (await fetch(`https://ghcr.io/token?scope=repository:${repo}:pull&service=ghcr.io`, { cache: 'no-store', signal: AbortSignal.timeout(5000) })).json()) as { token?: string };
    if (!t.token) return false;
    const res = await fetch(`https://ghcr.io/v2/${repo}/manifests/${sha}`, {
      method: 'HEAD',
      headers: { authorization: `Bearer ${t.token}`, accept: 'application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function desiredImage(current?: string): Promise<string> {
  if (process.env.AI_WORKER_IMAGE) return process.env.AI_WORKER_IMAGE;
  const sha = process.env.VERCEL_GIT_COMMIT_SHA;
  return nextImage(current, sha, sha ? await imageBuilt(sha) : false);
}

/**
 * The endpoint runs this deployment's image (like the AI machine gets REPO_RAW at start) with this
 * deployment's idle time; a new image carries the current settings too. Only a changed image makes a
 * release (workers are replaced then); the idle time alone reaches the scheduler without one.
 */
async function syncImage(ep: Endpoint) {
  const image = await desiredImage(ep.image);
  const idleOk = ep.workers?.idleTimeout === IDLE_SECONDS;
  if (ep.image === image && idleOk) return;
  const body: Record<string, unknown> = idleOk ? {} : { workers: { min: 0, max: 1, idleTimeout: IDLE_SECONDS } };
  if (ep.image !== image) Object.assign(body, { image, env: { ...(ep.env ?? {}), ...workerEnv() } });
  await runpod(`/serverless/${encodeURIComponent(ep.id)}`, { method: 'PATCH', body: JSON.stringify(body) });
  ep.image = image;
  ep.workers = { ...(ep.workers ?? {}), min: 0, max: 1, idleTimeout: IDLE_SECONDS };
}

export interface ServerlessInfo {
  configured: boolean;
  /** An endpoint exists: jobs can be sent. */
  ready: boolean;
  pricePerHour: { from: number; to: number };
  /** The makers added on the AI machine (state/makers.json in R2); the built-in ones always work. */
  wanted: string[];
  note?: string;
}

export async function serverlessInfo(): Promise<ServerlessInfo> {
  const price = PRICE_PER_HOUR;
  if (!serverlessConfigured()) return { configured: false, ready: false, pricePerHour: price, wanted: [] };
  const [ep, wanted] = await Promise.all([ensureEndpoint().catch(() => null), wantedMakers()]);
  return {
    configured: true,
    ready: Boolean(ep),
    pricePerHour: price,
    wanted,
    ...(ep ? {} : { note: 'The serverless machine is not set up yet (no endpoint could be found or made).' }),
  };
}

/** Which makers were added on the AI machine (kept in R2 by the machine). */
async function wantedMakers(): Promise<string[]> {
  const conf = r2Config();
  if (!conf) return [];
  try {
    const saved = await createR2(conf).getJson<{ wanted?: unknown }>('state/makers.json');
    return Array.isArray(saved?.wanted) ? saved!.wanted.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

async function rp(path: string, init: RequestInit = {}) {
  const res = await fetch(RP_JOBS + path, {
    ...init,
    headers: { authorization: `Bearer ${process.env.RUNPOD_API_KEY}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const msg = String(body.error ?? body.message ?? `Runpod answered ${res.status}`).slice(0, 200);
    throw new ServerlessError(res.status === 402 || /balance/i.test(msg) ? 'Your Runpod balance is too low. Add funds on runpod.io.' : `Serverless machine: ${msg}`, res.status === 402 ? 402 : 502);
  }
  return body;
}

const jobId = (s: string) => /^[A-Za-z0-9-]{8,120}$/.test(s);

/** Send one job (the same body Make sends the AI machine). */
export async function serverlessStart(job: Record<string, unknown>): Promise<ServerlessJob> {
  const refused = serverlessRefusal(job);
  if (refused) throw new ServerlessError(refused, 422);
  const ep = await ensureEndpoint();
  if (!ep) throw new ServerlessError('The serverless machine is not set up yet.', 501);
  // Only the AI machine's own meme lab makes background jobs; only a member's key sets an owner.
  const { background: _b, owner: _o, ...clean } = job;
  const body = await rp(`${ep.id}/run`, { method: 'POST', body: JSON.stringify({ input: { op: 'make', job: clean } }) });
  const id = String(body.id ?? '');
  if (!jobId(id)) throw new ServerlessError('Serverless machine: unexpected answer from Runpod');
  return mapStatus(id, { ...body, status: body.status ?? 'IN_QUEUE' });
}

export async function serverlessStatus(id: string): Promise<ServerlessJob> {
  if (!jobId(id)) throw new ServerlessError('Unknown job', 404);
  const ep = await ensureEndpoint();
  if (!ep) throw new ServerlessError('The serverless machine is not set up yet.', 501);
  return mapStatus(id, await rp(`${ep.id}/status/${id}`));
}

export async function serverlessCancel(id: string): Promise<void> {
  if (!jobId(id)) throw new ServerlessError('Unknown job', 404);
  const ep = await ensureEndpoint();
  if (!ep) return;
  await rp(`${ep.id}/cancel/${id}`, { method: 'POST', body: '{}' }).catch(() => {});
}
