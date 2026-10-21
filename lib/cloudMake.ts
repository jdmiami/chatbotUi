import 'server-only';

/**
 * Serverless pictures and videos, for when the AI machine is off (or busy): the site sends the job
 * to a cloud maker and hands back the result. Keys stay here on the server.
 *
 *  - Cloudflare Workers AI (CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_AI_TOKEN): pictures with FLUX.1
 *    schnell, about 230 a day free, then about $0.0005 each. Answers straight away.
 *  - fal.ai (FAL_KEY): pictures (FLUX.1 schnell, about $0.003) and videos (LTX Video by default,
 *    a few cents a clip). Queued: the browser asks again until it is done.
 *  - Runpod Serverless (RUNPOD_API_KEY, the same key the site turns machines on with): Runpod's
 *    public endpoints, paid per use from the Runpod balance. Pictures with FLUX.1 schnell (about
 *    $0.003; RUNPOD_IMAGE_ENDPOINT=black-forest-labs-flux-1-dev for FLUX dev), videos with Pruna
 *    P-Video (720p, about $0.02 a second), both with the provider's safety filter on. Queued, like fal.
 *
 * Cloud makers don't allow adult content, so NSFW prompts are turned away here with a plain
 * reason (they can still be made on your own AI machine).
 */

export type CloudKind = 'image' | 'video';
export type CloudSize = 'square' | 'landscape' | 'portrait';
export type CloudProvider = 'cloudflare' | 'fal' | 'runpod';

const FAL_IMAGE = () => process.env.FAL_IMAGE_MODEL || 'fal-ai/flux/schnell';
const FAL_VIDEO = () => process.env.FAL_VIDEO_MODEL || 'fal-ai/ltx-video';
const CF_IMAGE = '@cf/black-forest-labs/flux-1-schnell';

const cloudflareOk = () => Boolean(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_AI_TOKEN);
const falOk = () => Boolean(process.env.FAL_KEY);
const runpodOk = () => Boolean(process.env.RUNPOD_API_KEY) && process.env.RUNPOD_SERVERLESS !== 'off';
// Only endpoints that take the same request as the default (and answer with output.result); another
// model needs its own adapter here first, so anything else falls back to the default.
const RP_IMAGES = ['black-forest-labs-flux-1-schnell', 'black-forest-labs-flux-1-dev'];
const RP_VIDEOS = ['p-video'];
const RP_IMAGE = () => (RP_IMAGES.includes(process.env.RUNPOD_IMAGE_ENDPOINT ?? '') ? process.env.RUNPOD_IMAGE_ENDPOINT! : RP_IMAGES[0]);
const RP_VIDEO = () => (RP_VIDEOS.includes(process.env.RUNPOD_VIDEO_ENDPOINT ?? '') ? process.env.RUNPOD_VIDEO_ENDPOINT! : RP_VIDEOS[0]);
const RP_API = 'https://api.runpod.ai/v2/';
/** Runpod's endpoint ids: letters, digits, dashes (never a URL someone else wrote). */
const rpId = (s: string) => /^[A-Za-z0-9-]{3,80}$/.test(s);

/** Which providers make what, best first (Cloudflare's free pictures before fal's paid ones). */
export function cloudMakeInfo() {
  const image: { id: CloudProvider; name: string; price: string }[] = [];
  if (cloudflareOk()) image.push({ id: 'cloudflare', name: 'Cloudflare', price: 'about 230 a day free, then $0.0005 each' });
  if (runpodOk()) image.push({ id: 'runpod', name: 'Runpod', price: 'about $0.003 each, from your Runpod balance' });
  if (falOk()) image.push({ id: 'fal', name: 'fal.ai', price: 'about $0.003 each' });
  const video: { id: CloudProvider; name: string; price: string }[] = [];
  if (runpodOk()) video.push({ id: 'runpod', name: 'Runpod', price: 'about $0.10 for 5 seconds, from your Runpod balance' });
  if (falOk()) video.push({ id: 'fal', name: 'fal.ai', price: 'a few cents a clip' });
  return { configured: image.length + video.length > 0, image, video };
}

// The same words the AI machine and Orbit treat as NSFW (orbit/src/ui/nsfw.ts).
const SEXUAL =
  /\b(nude|nudes|nudity|naked|nsfw|sex|sexual|sexy|porn\w*|explicit|erotic\w*|topless|bottomless|breasts?|boobs?|nipples?|genital\w*|penis|vagina|pussy|cock|dick|orgasm\w*|masturbat\w*|lingerie|undress\w*|strip\w*|seductive|sensual|fetish|bdsm|cum|blowjob|handjob|intercourse|aroused|horny|lewd|hentai|panties|underwear|thong|spread\s+legs|onlyfans)\b/;
const UNDRESS =
  /\b(unclothe\w*|remove\s+(her|his|their|the)?\s*(clothes|clothing|shirt|top|dress|bra|pants|underwear)|(?:take|takes|taking|took)\s+off\s+(her|his|their)?\s*(clothes|clothing)|without\s+clothes|x-?ray)\b/;

/** Why a prompt can't go to a cloud maker, or null when it can. */
export function cloudRefusal(prompt: string): string | null {
  const t = prompt.toLowerCase().replace(/[_*~`#]/g, ' ');
  if (SEXUAL.test(t) || UNDRESS.test(t)) return "Cloud makers don't allow adult content. Make this one on your own AI machine.";
  return null;
}

export class CloudMakeError extends Error {
  constructor(
    message: string,
    public status = 502,
  ) {
    super(message);
  }
}

export interface CloudJob {
  /** Opaque; ask about it with cloudMakeStatus(). */
  id: string;
  status: 'queued' | 'running' | 'done' | 'error';
  position?: number | null;
  /** When done: an https link or a data: URL. */
  url?: string;
  error?: string;
  provider: CloudProvider;
  kind: CloudKind;
}

const FAL_QUEUE = 'https://queue.fal.run/';
const sizes: Record<CloudSize, { fal: string; w: number; h: number }> = {
  square: { fal: 'square_hd', w: 1024, h: 1024 },
  landscape: { fal: 'landscape_16_9', w: 1344, h: 768 },
  portrait: { fal: 'portrait_16_9', w: 768, h: 1344 },
};

const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
function dec(id: string): { p: CloudProvider; k: CloudKind; s: string; r: string } | null {
  try {
    const o = JSON.parse(Buffer.from(id, 'base64url').toString('utf8'));
    // Runpod: the endpoint id and the job id (s, r), both checked, so only Runpod's API is asked.
    if (o?.p === 'runpod') return typeof o.s === 'string' && typeof o.r === 'string' && rpId(o.s) && /^[A-Za-z0-9-]{8,120}$/.test(o.r) ? o : null;
    // Only ever ask fal's own queue about a job (never a URL someone else wrote).
    if (o?.p !== 'fal' || typeof o.s !== 'string' || typeof o.r !== 'string' || !o.s.startsWith(FAL_QUEUE) || !o.r.startsWith(FAL_QUEUE)) return null;
    return o;
  } catch {
    return null;
  }
}

async function falFetch(url: string, init: RequestInit = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { authorization: `Key ${process.env.FAL_KEY}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const detail = (body.detail ?? body.error ?? body.message) as unknown;
    const msg = typeof detail === 'string' ? detail : Array.isArray(detail) ? JSON.stringify(detail).slice(0, 200) : `fal.ai answered ${res.status}`;
    throw new CloudMakeError(`Cloud maker: ${msg}`, res.status === 401 || res.status === 403 ? 502 : res.status);
  }
  return body;
}

async function runpodFetch(path: string, init: RequestInit = {}) {
  const res = await fetch(RP_API + path, {
    ...init,
    headers: { authorization: `Bearer ${process.env.RUNPOD_API_KEY}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const msg = String(body.error ?? body.message ?? `Runpod answered ${res.status}`).slice(0, 200);
    // 402: the Runpod balance is empty.
    throw new CloudMakeError(res.status === 402 || /balance/i.test(msg) ? 'Cloud maker: your Runpod balance is too low. Add funds on runpod.io.' : `Cloud maker: ${msg}`, res.status === 402 ? 402 : 502);
  }
  return body;
}

async function cloudflareImage(prompt: string): Promise<string> {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(process.env.CLOUDFLARE_ACCOUNT_ID!)}/ai/run/${CF_IMAGE}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.CLOUDFLARE_AI_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ prompt, steps: 4 }),
    cache: 'no-store',
    signal: AbortSignal.timeout(50_000),
  });
  const body = (await res.json().catch(() => ({}))) as { result?: { image?: string }; errors?: { message?: string }[] };
  if (!res.ok || !body.result?.image) {
    const msg = body.errors?.[0]?.message || `Cloudflare answered ${res.status}`;
    throw new CloudMakeError(`Cloud maker: ${msg}`, res.status === 429 ? 429 : 502);
  }
  return `data:image/jpeg;base64,${body.result.image}`;
}

/** Start a picture or a video. Pictures from Cloudflare come back finished. */
export async function cloudMakeStart(req: { kind: CloudKind; prompt: string; size: CloudSize; seconds?: number; provider?: CloudProvider }): Promise<CloudJob> {
  const info = cloudMakeInfo();
  const list = req.kind === 'video' ? info.video : info.image;
  if (!list.length) throw new CloudMakeError(req.kind === 'video' ? 'No cloud video maker is set up yet (FAL_KEY in Vercel).' : 'No cloud picture maker is set up yet (CLOUDFLARE_* or FAL_KEY in Vercel).', 501);
  const order = req.provider ? [...list].sort((a) => (a.id === req.provider ? -1 : 0)) : list;
  let last: unknown = null;
  for (const p of order) {
    try {
      if (p.id === 'cloudflare') {
        const url = await cloudflareImage(req.prompt);
        return { id: `cf:${Date.now().toString(36)}`, status: 'done', url, provider: 'cloudflare', kind: 'image' };
      }
      if (p.id === 'runpod') {
        const endpoint = req.kind === 'video' ? RP_VIDEO() : RP_IMAGE();
        if (!rpId(endpoint)) throw new CloudMakeError('Cloud maker: RUNPOD_*_ENDPOINT is not a Runpod endpoint id.', 500);
        const size = sizes[req.size] ?? sizes.square;
        const input =
          req.kind === 'video'
            ? // P-Video's safety filter is off unless asked for.
              { prompt: req.prompt, duration: req.seconds ?? 5, resolution: '720p', aspect_ratio: req.size === 'portrait' ? '9:16' : req.size === 'square' ? '1:1' : '16:9', disable_safety_filter: false }
            : { prompt: req.prompt, width: size.w, height: size.h, num_inference_steps: 4, seed: -1, enable_safety_checker: true };
        const body = await runpodFetch(`${endpoint}/run`, { method: 'POST', body: JSON.stringify({ input }) });
        const job = String(body.id ?? '');
        if (!/^[A-Za-z0-9-]{8,120}$/.test(job)) throw new CloudMakeError('Cloud maker: unexpected answer from Runpod');
        return { id: enc({ p: 'runpod', k: req.kind, s: endpoint, r: job }), status: 'queued', provider: 'runpod', kind: req.kind };
      }
      const model = req.kind === 'video' ? FAL_VIDEO() : FAL_IMAGE();
      const size = sizes[req.size] ?? sizes.square;
      const input =
        req.kind === 'video'
          ? { prompt: req.prompt, aspect_ratio: req.size === 'portrait' ? '9:16' : req.size === 'square' ? '1:1' : '16:9', ...(req.seconds ? { duration: req.seconds } : {}) }
          : { prompt: req.prompt, image_size: size.fal, num_images: 1, enable_safety_checker: true };
      const body = await falFetch(FAL_QUEUE + model, { method: 'POST', body: JSON.stringify(input) });
      const s = String(body.status_url ?? '');
      const r = String(body.response_url ?? '');
      if (!s.startsWith(FAL_QUEUE) || !r.startsWith(FAL_QUEUE)) throw new CloudMakeError('Cloud maker: unexpected answer from fal.ai');
      return { id: enc({ p: 'fal', k: req.kind, s, r }), status: 'queued', position: Number(body.queue_position ?? 0) || null, provider: 'fal', kind: req.kind };
    } catch (err) {
      last = err;
      // A refusal of the prompt itself won't go better elsewhere.
      if (err instanceof CloudMakeError && err.status === 422) break;
    }
  }
  throw last instanceof CloudMakeError ? last : new CloudMakeError((last as Error)?.message || 'The cloud makers are busy. Try again in a moment.', 503);
}

/** Where a queued job is; the result link once it is done. */
export async function cloudMakeStatus(id: string): Promise<CloudJob> {
  const job = dec(id);
  if (!job) throw new CloudMakeError('Unknown job', 404);
  if (job.p === 'runpod') {
    const st = await runpodFetch(`${job.s}/status/${job.r}`);
    const status = String(st.status ?? '');
    if (status === 'IN_QUEUE') return { id, status: 'queued', provider: 'runpod', kind: job.k };
    if (status === 'IN_PROGRESS') return { id, status: 'running', provider: 'runpod', kind: job.k };
    if (status !== 'COMPLETED') {
      const why = String((st.error as string | undefined) ?? '').slice(0, 200);
      return { id, status: 'error', error: why ? `The cloud maker stopped: ${why}` : `The cloud maker stopped (${status.toLowerCase().replace(/_/g, ' ') || 'unknown'}).`, provider: 'runpod', kind: job.k };
    }
    const out = (st.output ?? {}) as { result?: unknown; image_url?: unknown; video_url?: unknown; url?: unknown };
    const url = [out.result, out.video_url, out.image_url, out.url].find((u): u is string => typeof u === 'string' && /^https:\/\//.test(u));
    if (!url) return { id, status: 'error', error: 'The cloud maker finished without a file.', provider: 'runpod', kind: job.k };
    return { id, status: 'done', url, provider: 'runpod', kind: job.k };
  }
  const st = await falFetch(job.s);
  const status = String(st.status ?? '');
  if (status === 'IN_QUEUE') return { id, status: 'queued', position: Number(st.queue_position ?? 0) || null, provider: 'fal', kind: job.k };
  if (status !== 'COMPLETED') return { id, status: 'running', provider: 'fal', kind: job.k };
  const out = await falFetch(job.r);
  const url =
    job.k === 'video'
      ? ((out.video as { url?: string } | undefined)?.url ?? (out.output as { url?: string } | undefined)?.url)
      : ((out.images as { url?: string }[] | undefined)?.[0]?.url ?? (out.image as { url?: string } | undefined)?.url);
  if (out.has_nsfw_concepts && Array.isArray(out.has_nsfw_concepts) && out.has_nsfw_concepts[0]) {
    return { id, status: 'error', error: "The cloud maker's safety check held this one back.", provider: 'fal', kind: job.k };
  }
  if (!url || !/^https:\/\//.test(url)) return { id, status: 'error', error: 'The cloud maker finished without a file.', provider: 'fal', kind: job.k };
  return { id, status: 'done', url, provider: 'fal', kind: job.k };
}
