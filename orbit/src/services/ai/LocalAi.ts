/**
 * Your own models on the AI machine (Open WebUI + Ollama on a Runpod GPU pod), for Orbit's AI app.
 *
 * The site (same origin as Orbit) says whether the AI machine is on and hands out a 1-hour token for
 * its OpenAI-compatible API (POST /api/ai/token). Chats stream straight from the AI machine.
 * The token lives only in memory.
 */

export type AiMachineState = 'unconfigured' | 'off' | 'starting' | 'downloading' | 'on' | 'error';

export interface AiMachineStatus {
  state: AiMachineState;
  costPerHour: number | null;
  detail?: string;
  pulling?: { model: string; percent: number } | null;
  models?: string[];
  idle?: { limitMinutes: number; idleMinutes: number } | null;
  tier?: string | null;
  tiers?: AiTier[];
}

export interface AiTier {
  id: string;
  label: string;
  gpuName: string;
  pricePerHour: number;
  idleMinutes: number;
  speed: string;
}

export type StudioKind = 'image' | 'video';

export interface StudioItem {
  id: string;
  kind: StudioKind;
  prompt: string;
  width?: number;
  height?: number;
  seconds?: number;
  fromImage?: boolean;
  /** Which maker made it (soreal: a joined movie). */
  maker?: string;
  /** soReal: the movie it was joined from. */
  movie?: string;
  createdAt: string;
  /** Absolute link to the file (works in <img>/<video> tags for 12 hours). */
  url: string;
}

export interface StudioJob {
  id: string;
  kind: StudioKind;
  prompt: string;
  status: 'queued' | 'running' | 'done' | 'error' | 'stopped';
  progress: number;
  error: string | null;
  createdAt: string;
  item: StudioItem | null;
  /** The machine's queue: 0 while it is being made, else its place in line (1 = next). */
  position?: number;
  /** How long this kind of job usually takes, and how long until it is done (including the wait). */
  expectedSeconds?: number;
  etaSeconds?: number | null;
  /** Running past 1.5x its usual time. */
  slow?: boolean;
  /** 1, or 2 when the machine stopped it and started it again. */
  attempt?: number;
  /** What the machine did on its own (plain words), e.g. "The maker was frozen, so it was restarted." */
  notes?: string[];
}

export interface StudioMaker {
  ready: boolean;
  downloaded: boolean;
  percent: number;
}

export interface StudioState {
  setup: string;
  running: boolean;
  image: StudioMaker;
  video: StudioMaker;
  downloading: { name: string; percent: number } | null;
  downloadError: string | null;
  jobs: StudioJob[];
}

/** A maker in the studio's store (Create → Makers). */
export interface StudioMakerInfo {
  id: string;
  kind: 'image' | 'video' | 'edit' | 'upscale' | 'style';
  name: string;
  blurb: string;
  /** For a style: the maker it belongs to. */
  for: string | null;
  /** Needs two pictures (outfit swap: the person, then the outfit). */
  twoImages: boolean;
  builtIn: boolean;
  wanted: boolean;
  installed: boolean;
  size: number;
  percent: number;
}

export interface StudioRequest {
  kind: StudioKind;
  /** Which maker to use (default: the built-in one for the kind). */
  maker?: string;
  /** A style for the maker (Krea Real). */
  style?: string;
  /** Pictures to edit, as data URLs (after `fromItem`, if any). */
  images?: string[];
  prompt: string;
  size?: string;
  seconds?: number;
  /** Starting picture for a video, as a data URL. */
  image?: string;
  /** Or a picture from the gallery, by id. */
  fromItem?: string;
}

/** soReal: one shot of a movie (a video made from the last frame of the shot before). */
export interface MovieShot {
  id: string;
  prompt: string;
  itemId: string | null;
  status: 'todo' | 'making' | 'done' | 'error';
  error: string | null;
}

/** soReal: a movie plan, kept on the AI machine. */
export interface Movie {
  id: string;
  title: string;
  /** Who is in it and the style; added to every shot so it stays consistent. */
  look: string;
  maker: 'ltx' | 'h3-max';
  size: 'landscape' | 'portrait' | 'square';
  seconds: number;
  /** Gallery picture or video the first shot continues from. */
  start: string | null;
  shots: MovieShot[];
  render: { itemId: string; at: string } | null;
  running: boolean;
  /** Which machine is making it (while running). */
  runningOn: AiMachine | null;
  createdAt: string;
  updatedAt: string;
}

export type MovieDraft = Partial<Pick<Movie, 'title' | 'look' | 'maker' | 'size' | 'seconds' | 'start'>> & {
  shots?: Partial<MovieShot>[];
};

export type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  /** Text, or text plus photos for models that can see. */
  content: string | ContentPart[];
}

export interface StreamHandlers {
  onText(delta: string): void;
  /** The model's visible reasoning ("thinking"), when it sends it. */
  onReasoning?(delta: string): void;
  /** Token counts, sent once at the end. */
  onUsage?(usage: { promptTokens: number; completionTokens: number }): void;
}

export interface WebResult {
  title: string;
  url: string;
  snippet: string;
  /** Readable text of the page, for the top results. */
  text?: string;
}

// ---- model store

export interface InstalledModel {
  name: string;
  size: number;
  loaded: boolean;
  vision: boolean;
  tools: boolean;
  thinking: boolean;
  family: string;
  params: string;
  quant: string;
}

export interface ModelPull {
  name: string;
  status: string;
  percent: number;
  error: string | null;
  done: boolean;
}

export interface ModelList {
  installed: InstalledModel[];
  pulls: ModelPull[];
  disk: { total: number; free: number } | null;
}

export interface FeaturedModel {
  spec: string;
  name: string;
  title: string;
  blurb: string;
  tags: string[];
  size: number;
  installed: boolean;
}

export interface HubModel {
  repo: string;
  downloads: number;
  likes: number;
  updatedAt: string | null;
}

export interface HubFile {
  quant: string;
  file: string;
  size: number;
}

export type InstallRequest = { spec: string } | { repo: string; quant: string; name?: string };

export class AiError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
  }
}

interface Grant {
  /** The main machine; null while only the helper is on. */
  url: string | null;
  /** The helper machine (images and videos only), when it is on. */
  helper: string | null;
  token: string;
  expires: number;
}

export type AiMachine = 'main' | 'helper';

/** The optional second AI machine that only makes images and videos (soReal: two movies at once). */
export interface HelperStatus {
  state: 'unconfigured' | 'off' | 'starting' | 'on' | 'error';
  costPerHour: number | null;
  pricePerHour: number;
  detail?: string;
  idle?: { limitMinutes: number; idleMinutes: number } | null;
}

async function siteJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    cache: 'no-store',
    credentials: 'same-origin',
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) throw new AiError('Your sign-in expired. Reload to sign in again.', 401);
  if (!res.ok) throw new AiError(body.error ?? `Request failed (${res.status})`, res.status);
  return body as T;
}

/** Parse an OpenAI-style SSE stream ("data: {...}" lines, "data: [DONE]"). Exported for tests. */
export async function readChatStream(body: ReadableStream<Uint8Array>, h: StreamHandlers, signal?: AbortSignal) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      if (signal?.aborted) break;
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') return;
        let msg: {
          choices?: { delta?: { content?: string; reasoning?: string; reasoning_content?: string } }[];
          error?: { message?: string };
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        try {
          msg = JSON.parse(data);
        } catch {
          continue;
        }
        if (msg.error) throw new AiError(msg.error.message ?? 'The model reported an error.');
        if (msg.usage) h.onUsage?.({ promptTokens: msg.usage.prompt_tokens ?? 0, completionTokens: msg.usage.completion_tokens ?? 0 });
        const delta = msg.choices?.[0]?.delta;
        const reasoning = delta?.reasoning ?? delta?.reasoning_content;
        if (reasoning) h.onReasoning?.(reasoning);
        if (delta?.content) h.onText(delta.content);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export class LocalAi {
  private grant: Grant | null = null;

  status(): Promise<AiMachineStatus> {
    return siteJson<AiMachineStatus>('/api/ai');
  }

  power(action: 'start' | 'stop', tier?: string): Promise<AiMachineStatus> {
    return siteJson<AiMachineStatus>('/api/ai', { method: 'POST', body: JSON.stringify({ action, tier }) });
  }

  /** Address + token of the AI machine; null while it isn't ready. */
  private async access(force = false): Promise<Grant | null> {
    if (!force && this.grant && this.grant.expires - Date.now() > 120_000) return this.grant;
    const r = await siteJson<{ url: string | null; helperUrl?: string | null; token: string | null; expiresIn: number }>('/api/ai/token', {
      method: 'POST',
      body: '{}',
    });
    // Keep the grant when only the helper is on, so a movie it is making can still be stopped.
    this.grant = (r.url || r.helperUrl) && r.token ? { url: r.url, helper: r.helperUrl ?? null, token: r.token, expires: Date.now() + r.expiresIn * 1000 } : null;
    return this.grant;
  }

  private async call(path: string, init: RequestInit, retry = true, machine: AiMachine = 'main'): Promise<Response> {
    let g = await this.access();
    // The helper may have come on since the last token: ask again once.
    if (g && machine === 'helper' && !g.helper) g = await this.access(true);
    if (machine === 'helper' && !g?.helper) throw new AiError('Your helper machine is not on yet.', 503);
    if (!g || (machine === 'main' && !g.url)) throw new AiError('Your AI machine is not on yet.', 503);
    const res = await fetch(`${machine === 'helper' ? g.helper : g.url}${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), authorization: `Bearer ${g.token}` },
    }).catch((err: Error) => {
      if (init.signal?.aborted) throw err;
      throw new AiError('Could not reach your AI machine. It may be starting or just turned itself off.');
    });
    if (res.status === 401 && retry) {
      await this.access(true);
      return this.call(path, init, false, machine);
    }
    return res;
  }

  async listModels(): Promise<string[]> {
    const res = await this.call('/v1/models', { method: 'GET' });
    if (!res.ok) throw new AiError(`Models: ${res.status}`, res.status);
    const body = (await res.json()) as { data?: { id: string }[] };
    return (body.data ?? []).map((m) => m.id).sort();
  }

  // ---- model store

  modelList(): Promise<ModelList> {
    return this.studioCall<ModelList>('/_orbit/models');
  }

  featuredModels(): Promise<FeaturedModel[]> {
    return this.studioCall<{ models: FeaturedModel[] }>('/_orbit/models/featured').then((r) => r.models);
  }

  async searchModels(q: string): Promise<HubModel[]> {
    return (await this.studioCall<{ results: HubModel[] }>(`/_orbit/models/search?q=${encodeURIComponent(q)}`)).results;
  }

  async modelFiles(repo: string): Promise<HubFile[]> {
    return (await this.studioCall<{ files: HubFile[] }>(`/_orbit/models/files?repo=${encodeURIComponent(repo)}`)).files;
  }

  async installModel(req: InstallRequest): Promise<string> {
    return (await this.studioCall<{ name: string }>('/_orbit/models/install', { method: 'POST', body: JSON.stringify(req) })).name;
  }

  async removeModel(name: string): Promise<void> {
    await this.studioCall(`/_orbit/models/${encodeURIComponent(name)}`, { method: 'DELETE' });
  }

  async loadModel(name: string): Promise<void> {
    await this.studioCall('/_orbit/models/load', { method: 'POST', body: JSON.stringify({ name }) });
  }

  async dismissPull(name: string): Promise<void> {
    await this.studioCall('/_orbit/models/dismiss', { method: 'POST', body: JSON.stringify({ name }) });
  }

  // ---- web search and speech to text (both run on the AI machine)

  async webSearch(q: string, signal?: AbortSignal): Promise<{ query: string; results: WebResult[] }> {
    return this.studioCall(`/_orbit/search?q=${encodeURIComponent(q.slice(0, 300))}&pages=3`, { signal });
  }

  async transcribe(audio: Blob, signal?: AbortSignal): Promise<string> {
    const res = await this.call('/_orbit/voice/transcribe', { method: 'POST', body: audio, signal, headers: { 'content-type': audio.type || 'audio/webm' } });
    const body = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
    if (!res.ok) throw new AiError(body.error || `The AI machine answered ${res.status}.`, res.status);
    return body.text ?? '';
  }

  // ---- image and video maker

  private async studioCall<T>(path: string, init: RequestInit = {}, machine: AiMachine = 'main'): Promise<T> {
    const res = await this.call(path, { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } }, true, machine);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = typeof body.error === 'string' ? body.error : body.error?.message;
      throw new AiError(msg || `The AI machine answered ${res.status}.`, res.status);
    }
    return body as T;
  }

  private absolute<T extends { url?: string } | null>(item: T): T {
    if (!item || !this.grant || !item.url || /^https?:/.test(item.url)) return item;
    return { ...item, url: (this.grant.url ?? this.grant.helper ?? '') + item.url };
  }
  private absoluteJob(job: StudioJob): StudioJob {
    return { ...job, item: this.absolute(job.item) };
  }

  studioState(): Promise<StudioState> {
    return this.studioCall<StudioState>('/_orbit/studio').then((s) => ({ ...s, jobs: s.jobs.map((j) => this.absoluteJob(j)) }));
  }

  async studioItems(): Promise<StudioItem[]> {
    const r = await this.studioCall<{ items: StudioItem[] }>('/_orbit/studio/items');
    return r.items.map((i) => this.absolute(i));
  }

  async studioMakers(): Promise<StudioMakerInfo[]> {
    const { makers } = await this.studioCall<{ makers?: StudioMakerInfo[] }>('/_orbit/studio/makers');
    if (!Array.isArray(makers)) throw new AiError('The AI machine sent an unexpected answer. Try again in a moment.');
    return makers;
  }

  async installStudioMaker(id: string): Promise<StudioMakerInfo[]> {
    return (await this.studioCall<{ makers: StudioMakerInfo[] }>('/_orbit/studio/makers/install', { method: 'POST', body: JSON.stringify({ id }) })).makers;
  }

  async removeStudioMaker(id: string): Promise<StudioMakerInfo[]> {
    return (await this.studioCall<{ makers: StudioMakerInfo[] }>('/_orbit/studio/makers/remove', { method: 'POST', body: JSON.stringify({ id }) })).makers;
  }

  async createStudioJob(req: StudioRequest): Promise<StudioJob> {
    return this.absoluteJob(await this.studioCall<StudioJob>('/_orbit/studio/jobs', { method: 'POST', body: JSON.stringify(req) }));
  }

  async studioJob(id: string): Promise<StudioJob> {
    return this.absoluteJob(await this.studioCall<StudioJob>(`/_orbit/studio/jobs/${encodeURIComponent(id)}`));
  }

  async cancelStudioJob(id: string): Promise<void> {
    await this.studioCall(`/_orbit/studio/jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: '{}' });
  }

  async deleteStudioItem(id: string): Promise<void> {
    await this.studioCall(`/_orbit/studio/items/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  // ---- soReal movies

  async movies(): Promise<Movie[]> {
    return (await this.studioCall<{ movies: Movie[] }>('/_orbit/studio/movies')).movies;
  }

  createMovie(draft: MovieDraft): Promise<Movie> {
    return this.studioCall<Movie>('/_orbit/studio/movies', { method: 'POST', body: JSON.stringify(draft) });
  }

  movie(id: string): Promise<Movie> {
    return this.studioCall<Movie>(`/_orbit/studio/movies/${encodeURIComponent(id)}`);
  }

  updateMovie(id: string, draft: MovieDraft): Promise<Movie> {
    return this.studioCall<Movie>(`/_orbit/studio/movies/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(draft) });
  }

  async deleteMovie(id: string): Promise<void> {
    await this.studioCall(`/_orbit/studio/movies/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  /** Make the shots that aren't done yet, in order, on the main or the helper machine (keeps going there). */
  runMovie(id: string, on: AiMachine = 'main'): Promise<Movie> {
    return this.studioCall<Movie>(`/_orbit/studio/movies/${encodeURIComponent(id)}/run`, { method: 'POST', body: '{}' }, on);
  }

  /** Stop it on the machine that is making it. */
  stopMovie(id: string, on: AiMachine = 'main'): Promise<Movie> {
    return this.studioCall<Movie>(`/_orbit/studio/movies/${encodeURIComponent(id)}/stop`, { method: 'POST', body: '{}' }, on);
  }

  // ---- the helper machine

  helperStatus(): Promise<HelperStatus> {
    return siteJson<HelperStatus>('/api/ai/helper');
  }

  async helperPower(action: 'start' | 'stop'): Promise<HelperStatus> {
    const s = await siteJson<HelperStatus>('/api/ai/helper', { method: 'POST', body: JSON.stringify({ action }) });
    this.grant = null; // its address changes the token answer
    return s;
  }

  /** Join the finished shots into one video in the gallery. */
  async renderMovie(id: string): Promise<{ movie: Movie; item: StudioItem }> {
    const r = await this.studioCall<{ movie: Movie; item: StudioItem }>(`/_orbit/studio/movies/${encodeURIComponent(id)}/render`, { method: 'POST', body: '{}' });
    return { movie: r.movie, item: this.absolute(r.item) };
  }

  /** Stream one reply. Resolves when the model is done (or the signal aborts). */
  async chat(model: string, messages: ChatMessage[], h: StreamHandlers, signal?: AbortSignal): Promise<void> {
    const res = await this.call('/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: true, stream_options: { include_usage: true } }),
      signal,
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      let message = text;
      try {
        message = JSON.parse(text).error?.message ?? text;
      } catch {
        /* plain text */
      }
      throw new AiError(message || `The AI machine answered ${res.status}.`, res.status);
    }
    await readChatStream(res.body, h, signal);
  }
}

let shared: LocalAi | null = null;
export function getLocalAi(): LocalAi {
  shared ??= new LocalAi();
  return shared;
}
