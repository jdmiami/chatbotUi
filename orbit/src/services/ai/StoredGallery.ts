import { AiError } from './LocalAi';

/**
 * The gallery kept in cloud storage (the site's /api/gallery, which reads Cloudflare R2 directly),
 * so every creation shows while the AI machine is off. Until the site has the storage keys it says
 * so ({ configured: false }) and the Gallery shows the machine's own gallery when it is on.
 */
export type CreationSource = 'make' | 'cloud' | 'lab' | 'soreal' | 'livedraw';

export interface StoredItem {
  id: string;
  kind: 'image' | 'video';
  source: CreationSource;
  maker?: string;
  prompt: string;
  title?: string;
  caption?: string;
  hashtags?: string[];
  score?: number;
  width?: number;
  height?: number;
  seconds?: number;
  movie?: string;
  nsfw?: boolean;
  nsfwUser?: boolean;
  lab: boolean;
  createdAt: string;
  url: string;
  downloadUrl: string;
  bytes: number;
}

export interface StoredGallery {
  configured: boolean;
  items: StoredItem[];
  message?: string;
}

const ENDPOINT = '/api/gallery';

async function call<T>(init?: RequestInit): Promise<T> {
  const res = await fetch(ENDPOINT, { cache: 'no-store', credentials: 'same-origin', ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  if (!(res.headers.get('content-type') ?? '').includes('json')) throw new AiError('Your stored gallery is only there when Orbit is opened from your workspace site.', res.status);
  const body = (await res.json()) as T & { error?: string };
  if (res.status === 401) throw new AiError('Your sign-in expired. Reload to sign in again.', 401);
  if (!res.ok) throw new AiError(body.error ?? `Storage answered ${res.status}.`, res.status);
  return body;
}

/** Everything in cloud storage; null when there is no site behind Orbit (a preview). Throws when storage can't be read. */
export async function storedGallery(): Promise<StoredGallery | null> {
  let res: Response;
  try {
    res = await fetch(ENDPOINT, { cache: 'no-store', credentials: 'same-origin' });
  } catch {
    throw new AiError('Could not reach your stored gallery. Check the connection and try again.');
  }
  if (!(res.headers.get('content-type') ?? '').includes('json')) return null;
  const body = (await res.json().catch(() => ({}))) as StoredGallery & { error?: string };
  if (res.status === 401) throw new AiError('Your sign-in expired. Reload to sign in again.', 401);
  if (!res.ok) throw new AiError(body.error ?? `Storage answered ${res.status}.`, res.status);
  return { configured: body.configured === true, items: Array.isArray(body.items) ? body.items : [], message: body.message };
}

export function markStoredNsfw(id: string, nsfw: boolean | null): Promise<void> {
  return call<void>({ method: 'POST', body: JSON.stringify({ action: 'nsfw', id, nsfw }) });
}

export function keepStored(id: string): Promise<void> {
  return call<void>({ method: 'POST', body: JSON.stringify({ action: 'keep', id }) });
}

export function deleteStored(id: string): Promise<void> {
  return call<void>({ method: 'POST', body: JSON.stringify({ action: 'delete', id }) });
}

/** A cloud creation saved straight into the stored gallery (the machine can stay off). */
export function saveCloudToStorage(body: { url: string; kind: 'image' | 'video'; prompt: string; maker: string }): Promise<{ ok: true; id: string }> {
  return call<{ ok: true; id: string }>({ method: 'POST', body: JSON.stringify({ action: 'import', ...body }) });
}

/** Where a creation came from, from its maker (the same rule as the site's lib/gallery.ts). */
export function sourceOf(it: { maker?: string; movie?: string; lab?: boolean }): CreationSource {
  const maker = String(it.maker || '');
  if (it.lab) return 'lab';
  if (maker.startsWith('cloud')) return 'cloud';
  if (maker === 'sketch-finish' || maker.startsWith('live-')) return 'livedraw';
  if (it.movie) return 'soreal';
  return 'make';
}
