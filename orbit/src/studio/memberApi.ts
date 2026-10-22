/**
 * The studio's line to its AI, for members (and for the owner trying a studio). It never uses the
 * owner's routes: the site's /api/studio/ai gives the address and a member key, and the AI machine's
 * /_studio routes accept only that key and keep each member's work to themselves.
 */
import { AiError, readChatStream, type ChatMessage, type MovieDraft, type StudioItem, type StudioJob, type StudioMakerInfo, type StudioRequest } from '../services/ai/LocalAi';

export type StudioState = 'unconfigured' | 'off' | 'starting' | 'downloading' | 'on' | 'error';

export interface MemberMovie {
  id: string;
  title: string;
  phase?: string;
  error?: string | null;
  etaSeconds?: number;
  running?: boolean;
  frames: { id: string; status: string; url: string | null }[];
  render: { itemId: string; url: string } | null;
}

let studioId = '';
let access: { state: StudioState; url: string | null; token: string | null; at: number } | null = null;

export function setStudioId(id: string) {
  if (id !== studioId) access = null;
  studioId = id;
}

async function site<T>(init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/studio/ai?studio=${encodeURIComponent(studioId)}`, {
    ...init,
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    cache: 'no-store',
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (res.status === 401) {
    window.location.href = `/studio/login?studio=${encodeURIComponent(studioId)}`;
    throw new AiError('Please sign in again.', 401);
  }
  if (!res.ok) throw new AiError(body.error ?? `The studio answered ${res.status}.`, res.status);
  return body;
}

async function refresh() {
  const a = await site<{ state: StudioState; url: string | null; token: string | null }>();
  access = { ...a, at: Date.now() };
  return access;
}

/** The address and key, fresh (keys last an hour; renewed after 50 minutes). */
async function ready() {
  if (!access?.url || !access.token || Date.now() - access.at > 50 * 60_000) await refresh();
  if (!access?.url || !access.token) throw new AiError('The studio is resting. It wakes up when you make something.', 503);
  return access as { url: string; token: string };
}

async function call(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const a = await ready();
  const res = await fetch(a.url + path, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${a.token}` } });
  if (res.status === 401 && retry) {
    access = null;
    return call(path, init, false);
  }
  return res;
}

async function json<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await call(path, { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new AiError(body.error ?? `The studio answered ${res.status}.`, res.status);
  return body;
}

/** Links come back relative to the AI's address. */
function absolute<T extends { url?: string | null }>(x: T): T {
  return x && x.url && x.url.startsWith('/') && access?.url ? { ...x, url: access.url + x.url } : x;
}

export const studioAi = {
  async status(): Promise<{ state: StudioState }> {
    return { state: (await refresh()).state };
  },
  async power(_action: 'start'): Promise<{ state: StudioState }> {
    const r = await site<{ state: StudioState }>({ method: 'POST', body: JSON.stringify({ action: 'start' }) });
    access = null;
    return r;
  },
  async studioMakers(): Promise<Pick<StudioMakerInfo, 'id' | 'kind' | 'name' | 'installed'>[]> {
    return (await json<{ makers: Pick<StudioMakerInfo, 'id' | 'kind' | 'name' | 'installed'>[] }>('/_studio/makers')).makers;
  },
  async createStudioJob(req: StudioRequest): Promise<StudioJob> {
    return json<StudioJob>('/_studio/jobs', { method: 'POST', body: JSON.stringify({ maker: req.maker, prompt: req.prompt, size: req.size, seconds: req.seconds, style: req.style }) });
  },
  async studioJob(id: string): Promise<StudioJob> {
    const j = await json<StudioJob>(`/_studio/jobs/${encodeURIComponent(id)}`);
    return j.item ? { ...j, item: absolute(j.item) } : j;
  },
  async studioItems(): Promise<StudioItem[]> {
    return (await json<{ items: StudioItem[] }>('/_studio/items')).items.map(absolute);
  },
  async createMovie(draft: MovieDraft): Promise<MemberMovie> {
    return json<MemberMovie>('/_studio/movies', { method: 'POST', body: JSON.stringify(draft) });
  },
  async movie(id: string): Promise<MemberMovie> {
    const m = await json<MemberMovie>(`/_studio/movies/${encodeURIComponent(id)}`);
    return { ...m, frames: m.frames.map(absolute), render: m.render ? absolute(m.render) : null };
  },
  async runMovie(id: string, opts: { approve?: boolean } = {}): Promise<MemberMovie> {
    return json<MemberMovie>(`/_studio/movies/${encodeURIComponent(id)}/run`, { method: 'POST', body: JSON.stringify(opts) });
  },
  /** The studio's writer, streamed (only while the studio is awake). */
  async chat(messages: ChatMessage[], onText: (d: string) => void, signal?: AbortSignal, maxTokens = 600): Promise<void> {
    const res = await call('/_studio/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages, max_tokens: maxTokens }), signal });
    if (!res.ok || !res.body) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new AiError(body.error ?? `The writer answered ${res.status}.`, res.status);
    }
    await readChatStream(res.body, { onText }, signal);
  },
  /** Whether the studio is awake right now (no waking it). */
  awake(): boolean {
    return access?.state === 'on' && Boolean(access.url);
  },
};
