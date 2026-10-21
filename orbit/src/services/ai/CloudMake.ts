import { AiError, type LocalAi } from './LocalAi';

/**
 * Pictures and videos made in the cloud (the site's /api/make: Cloudflare or fal.ai), for when the
 * AI machine is off. What comes back waits on this device (IndexedDB) and moves into the gallery
 * the next time the AI machine is on, so everything ends up in one place on every device.
 */

export type CloudKind = 'image' | 'video';
export type CloudSize = 'square' | 'landscape' | 'portrait';

export interface CloudMakeInfo {
  configured: boolean;
  image: { id: string; name: string; price: string }[];
  video: { id: string; name: string; price: string }[];
}

export interface CloudJob {
  id: string;
  status: 'queued' | 'running' | 'done' | 'error';
  position?: number | null;
  url?: string;
  error?: string;
  provider: string;
  kind: CloudKind;
}

/** Waiting on this device to move into the gallery. */
export interface CloudMade {
  id: string;
  kind: CloudKind;
  prompt: string;
  url: string;
  provider: string;
  createdAt: string;
}

const ENDPOINT = '/api/make';

async function call<T>(init?: RequestInit, query = ''): Promise<T> {
  const res = await fetch(ENDPOINT + query, { cache: 'no-store', credentials: 'same-origin', ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  if (!(res.headers.get('content-type') ?? '').includes('json')) throw new AiError('Cloud making is only there when Orbit is opened from your workspace site.', res.status);
  const body = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new AiError(body.error ?? `The cloud answered ${res.status}.`, res.status);
  return body;
}

export async function cloudMakeInfo(): Promise<CloudMakeInfo | null> {
  try {
    return await call<CloudMakeInfo>();
  } catch {
    return null;
  }
}

export function cloudMakeStart(req: { kind: CloudKind; prompt: string; size: CloudSize }): Promise<CloudJob> {
  return call<CloudJob>({ method: 'POST', body: JSON.stringify(req) });
}

export function cloudMakeStatus(id: string): Promise<CloudJob> {
  return call<CloudJob>(undefined, `?id=${encodeURIComponent(id)}`);
}

// ---- what waits on this device (IndexedDB: a Cloudflare picture comes back as a data: URL)

const DB = 'orbit-cloud-make';
const STORE = 'made';
function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise<T>((resolve, reject) => {
    const r = fn(d.transaction(STORE, mode).objectStore(STORE));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function cloudMadeList(): Promise<CloudMade[]> {
  try {
    const all = await tx<CloudMade[]>('readonly', (s) => s.getAll() as IDBRequest<CloudMade[]>);
    return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}
export async function cloudMadeAdd(item: CloudMade) {
  await tx('readwrite', (s) => s.put(item));
}
export async function cloudMadeRemove(id: string) {
  await tx('readwrite', (s) => s.delete(id));
}

let moving: Promise<number> | null = null;
/** With the AI machine on: move everything waiting here into the gallery. Resolves with how many moved. */
export function moveCloudMadeToGallery(ai: LocalAi): Promise<number> {
  moving ||= (async () => {
    let moved = 0;
    for (const it of await cloudMadeList()) {
      try {
        await ai.importCloudItem({ url: it.url, kind: it.kind, prompt: it.prompt, maker: `cloud:${it.provider}` });
        await cloudMadeRemove(it.id);
        moved++;
      } catch (err) {
        // An older AI machine (no import yet) or a link that expired: try again next time.
        if ((err as AiError).status === 404) break;
      }
    }
    return moved;
  })().finally(() => (moving = null));
  return moving;
}
