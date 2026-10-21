/**
 * Your own models on the AI machine (Open WebUI + Ollama on a Runpod GPU pod), for Orbit's AI app.
 *
 * The site (same origin as Orbit) says whether the AI machine is on and hands out a 1-hour token for
 * its OpenAI-compatible API (POST /api/ai/token). Chats stream straight from the AI machine.
 * The token lives only in memory.
 */
import type { LiveDrawState } from './liveDraw';

export type AiMachineState = 'unconfigured' | 'off' | 'starting' | 'downloading' | 'on' | 'error';

export interface AiMachineStatus {
  state: AiMachineState;
  costPerHour: number | null;
  detail?: string;
  pulling?: { model: string; percent: number } | null;
  models?: string[];
  idle?: AiIdle | null;
  /** The one auto-off rule's minutes (the same for every machine and speed). */
  autoOffMinutes?: number;
  tier?: string | null;
  tiers?: AiTier[];
}

/** The machine's own auto-off timer. */
export interface AiIdle {
  limitMinutes: number;
  idleMinutes: number;
  offAt?: string | null;
  heldUntil?: string | null;
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
  /** The AI machine's NSFW check, from the picture itself (unset: not checked yet). */
  nsfw?: boolean;
  /** Your own say: true blurs it, false never blurs it (unset: the check and the words decide). */
  nsfwUser?: boolean;
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
/** A meme-lab video: made while the AI machine was unused, scored by a chat model for how viral it could go. */
export interface MemeRecord {
  id: string;
  /** The AI machine's NSFW check flagged the video. */
  nsfw?: boolean;
  /** Your own say on it: true blurs it, false never blurs it. */
  nsfwUser?: boolean;
  url?: string;
  title: string;
  prompt: string;
  caption: string;
  hashtags: string[];
  seconds?: number;
  createdAt: string;
  /** 0–100, or null when there was no chat model to judge it. */
  score?: number | null;
  why?: string;
  /** judging · made (waiting to be judged) · judged · ready (scored high enough to post) */
  status: 'judging' | 'made' | 'judged' | 'ready';
  /** comedy · spicy · yours (a 30-second movie in your style). */
  style?: LabStyle;
  /** A movie in your style: its soReal movie (it moves into soReal when kept). */
  movieId?: string;
}
export interface LabIdea {
  id: string;
  title: string;
  prompt: string;
  topic: string | null;
  /** Written or edited by you: made exactly as written. */
  yours: boolean;
  /** "Your style": a 30-second movie (made with soReal's auto flow), with its look. */
  kind?: 'movie';
  seconds?: number;
  look?: string;
  /** Your style leans spicy: blurred like any NSFW item. */
  nsfw?: boolean;
}
/** comedy · spicy · yours: 30-second movies in your own style, from your saved prompts. */
export type LabStyle = 'comedy' | 'spicy' | 'yours';
/** Where a Lab movie is: the story, the lead, the storyboard, the shots, the final cut. */
export interface LabMovieProgress {
  id: string;
  phase: 'draft' | 'story' | 'lead' | 'storyboard' | 'review' | 'shots' | 'final' | 'done' | 'stopped' | 'error';
  /** Waiting for your job to finish (it made way, and carries on after). */
  paused: boolean;
  shots: number;
  shotsDone: number;
  etaSeconds: number | null;
  seconds: number;
}
/** A chip on the "Your style" panel: something the profile picked up (remove it to leave it out). */
export interface StyleChip {
  kind: 'subject' | 'look' | 'mood';
  text: string;
}
/** Your style: a profile of your own saved prompts, written on the AI machine (nothing leaves it). */
export interface YourStyleProfile {
  ready: boolean;
  building: boolean;
  /** In plain words; yours to edit (your edits steer it). */
  summary: string;
  edited: boolean;
  /** How many of your prompts it was built from, and when. */
  count: number;
  builtAt: string | null;
  /** ai: the chat model on the machine wrote it; words: a word count (no chat model). */
  by: 'ai' | 'words' | null;
  spicy: boolean;
  profile: Record<string, string[]>;
  chips: StyleChip[];
  removed: string[];
  lastError: string | null;
}
export interface MemeLabState {
  enabled: boolean;
  /** Comedy, or spicy: flirty thirst-trap clips of made-up adults, no nudity. Older machines don't say. */
  style?: LabStyle;
  /** Your topics; the planned ideas are built around them. */
  topics: string[];
  quietMinutes: number;
  readyScore: number;
  /** Minutes one lab video takes (learned), and minutes until the machine turns itself off. */
  minutesPerVideo: number;
  minutesLeft: number;
  making: { title: string; topic: string | null; prompt: string; job: StudioJob | null; movie?: LabMovieProgress | null; nsfw?: boolean } | null;
  /** Planned ideas, in the order they will be made. */
  queue: LabIdea[];
  madeLastHour: number;
  lastError: string | null;
  records: MemeRecord[];
}

/** What a maker works from, besides words: a video, a voice or song, a photo, an end photo, words naming a thing. */
export type StudioInput = 'video' | 'audio' | 'photo' | 'endPhoto' | 'target';
/** Wan VACE: what to do with the video. */
export type VideoTask = 'replace' | 'restyle' | 'extend' | 'motion';

export interface StudioMakerInfo {
  id: string;
  /** live: answers while you draw (Live draw); sketch: finishes a drawing (Sketch finish). */
  kind: 'image' | 'video' | 'edit' | 'upscale' | 'style' | 'videoedit' | 'live' | 'sketch';
  name: string;
  blurb: string;
  /** For a style: the maker it belongs to. */
  for: string | null;
  /** Needs two pictures (outfit swap: the person, then the outfit). */
  twoImages: boolean;
  /** What it must have, and what it can also take (older machines don't say). */
  needs?: StudioInput[];
  accepts?: StudioInput[];
  /** Wan VACE's tasks. */
  tasks?: VideoTask[];
  /** Its files are gated on Hugging Face (LTX-2.5); needsToken: the machine has no token for them. */
  gated?: boolean;
  needsToken?: boolean;
  /** Why its download is stuck, in plain words (a refused token). */
  problem?: string | null;
  builtIn: boolean;
  wanted: boolean;
  installed: boolean;
  size: number;
  percent: number;
  /** In Orbit's catalog but not on the AI machine's list: its code is older. Arrives when it restarts. */
  pending?: boolean;
  /** Only runs on the Turbo machine (80 GB): Krea Realtime. */
  turboOnly?: boolean;
  /** Its files are here and its own Python is being set up: what it is doing. */
  setup?: string;
}

/** A video or sound sent to the AI machine for a maker to work on. */
export interface StudioUpload {
  id: string;
  kind: 'video' | 'audio';
  size: number;
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
  /** The picture a video ends on, as a data URL. */
  endImage?: string;
  /** A gallery video to work on, or an uploaded one (StudioUpload id). */
  videoItem?: string;
  videoUpload?: string;
  /** An uploaded voice or song (StudioUpload id). */
  audioUpload?: string;
  /** Wan VACE: what to do; target: the words naming what to replace or erase. */
  task?: VideoTask;
  target?: string;
  /** LTX-2.5 video to video: change it a little or a lot. */
  change?: 'little' | 'lot';
  /** Sketch finish: how closely to follow the drawing's lines, 0..1. */
  follow?: number;
}

/** soReal: one shot of a movie (a video made from the last frame of the shot before). */
export interface MovieShot {
  id: string;
  prompt: string;
  itemId: string | null;
  status: 'todo' | 'making' | 'done' | 'error';
  error: string | null;
  /** New movies: what the picture looks like where the shot ends (its storyboard picture). */
  end?: string;
  /** What is said or sung in the shot, one line each: `Mara, softly: "Stay."` The maker speaks it. */
  says?: string;
  /** Seconds cut from the start and the end in the final cut. */
  trimStart?: number;
  trimEnd?: number;
  /** The storyboard pictures it starts and ends on (frame ids). */
  frames?: [string, string] | null;
  /** Ask for this shot to be made again. */
  redo?: boolean;
}

/** soReal: one storyboard picture (where a shot starts or ends). */
export interface MovieFrame {
  id: string;
  prompt: string;
  itemId: string | null;
  status: 'todo' | 'making' | 'done' | 'error';
  error: string | null;
  redo?: boolean;
}

export type MovieSound = 'auto' | 'shots' | 'music' | 'quiet';
export type MoviePhase = 'draft' | 'story' | 'lead' | 'storyboard' | 'review' | 'shots' | 'final' | 'done' | 'stopped' | 'error';

/** soReal: the lead character, designed by the AI or from a photo. */
export interface MovieLead {
  mode: 'auto' | 'ai' | 'photo' | 'none';
  description: string;
  itemId: string | null;
  jobId?: string | null;
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
  /** `stale`: shots changed since (redo, reorder, trim): join them again. */
  render: { itemId: string; at: string; stale?: boolean } | null;
  running: boolean;
  /** Which machine is making it (while running). */
  runningOn: AiMachine | null;
  createdAt: string;
  updatedAt: string;
  // ---- new movies (one idea in, a whole movie out); absent on movies made shot by shot
  flow?: 'auto';
  /** Named from the idea (then by the AI's story) until you name it. */
  autoTitle?: boolean;
  idea?: string;
  template?: string | null;
  /** Whole movie, seconds (30 at most). */
  length?: number;
  opening?: string;
  lead?: MovieLead;
  sound?: MovieSound;
  /** What the AI picked when sound is "auto". */
  soundPicked?: Exclude<MovieSound, 'auto'> | null;
  reviewStoryboard?: boolean;
  approved?: boolean;
  /** keyframes: each shot made between two storyboard pictures; chain: from the last frame. */
  continuity?: 'keyframes' | 'chain';
  /** Who wrote the story: the AI, a plain story from the idea (no chat model), or you. */
  story?: 'ai' | 'plain' | 'you' | null;
  frames?: MovieFrame[];
  phase?: MoviePhase;
  error?: string | null;
  /** Seconds left (or the whole time, before it starts), from the machine's own timings. */
  etaSeconds?: number;
  shotSeconds?: number;
}

export type MovieDraft = Partial<
  Pick<Movie, 'title' | 'look' | 'maker' | 'size' | 'seconds' | 'start' | 'idea' | 'template' | 'length' | 'opening' | 'sound' | 'reviewStoryboard'>
> & {
  shots?: Partial<MovieShot>[];
  frames?: Partial<MovieFrame>[];
  lead?: Partial<Pick<MovieLead, 'mode' | 'description'>>;
};

export interface MovieEstimate {
  seconds: number;
  shots: number;
  shotSeconds: number;
}

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
  idle?: AiIdle | null;
  autoOffMinutes?: number;
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

const MACHINE_STATES: AiMachineState[] = ['unconfigured', 'off', 'starting', 'downloading', 'on', 'error'];
/** A reply that isn't a machine status (a page instead of JSON, an older site) is an error, not a crash later. */
function machineStatus(s: AiMachineStatus): AiMachineStatus {
  if (!s || !MACHINE_STATES.includes(s.state)) throw new AiError('The site didn’t say how the AI machine is. Reload to try again.');
  return s;
}

export class LocalAi {
  private grant: Grant | null = null;

  async status(): Promise<AiMachineStatus> {
    return machineStatus(await siteJson<AiMachineStatus>('/api/ai'));
  }

  async power(action: 'start' | 'stop', tier?: string): Promise<AiMachineStatus> {
    return machineStatus(await siteJson<AiMachineStatus>('/api/ai', { method: 'POST', body: JSON.stringify({ action, tier }) }));
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

  // ---- live makers (Live draw)

  /** The main AI machine's address and a token, for Live draw's own connection (liveDraw.ts). */
  async liveAccess(): Promise<{ url: string; token: string } | null> {
    const g = await this.access();
    return g?.url ? { url: g.url, token: g.token } : null;
  }

  liveDrawState(): Promise<LiveDrawState> {
    return this.studioCall<LiveDrawState>('/_orbit/live/draw');
  }

  /** Live draw opened: the machine starts loading its model, so the first stroke doesn't wait. */
  warmLiveDraw(): Promise<LiveDrawState> {
    return this.studioCall<LiveDrawState>('/_orbit/live/draw/warm', { method: 'POST', body: '{}' });
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

  /**
   * A file's link, kept the same for a few hours. The machine signs a fresh link (good for 12 hours)
   * every time it lists a file, and a new link makes the browser download the picture or video again:
   * the Lab and the gallery refresh every few seconds, so without this everything would keep reloading.
   */
  private fileLinks = new Map<string, { url: string; at: number }>();
  private absolute<T extends { url?: string } | null>(item: T): T {
    if (!item || !this.grant || !item.url || /^https?:/.test(item.url)) return item;
    const url = (this.grant.url ?? this.grant.helper ?? '') + item.url;
    const key = url.replace(/[?#].*$/, '');
    const kept = this.fileLinks.get(key);
    if (kept && Date.now() - kept.at < 6 * 3600_000) return { ...item, url: kept.url };
    this.fileLinks.set(key, { url, at: Date.now() });
    return { ...item, url };
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

  /** Blur an item (true), never blur it (false), or let the NSFW check decide again (null). */
  async markNsfw(id: string, nsfw: boolean | null): Promise<void> {
    await this.studioCall(`/_orbit/studio/items/${encodeURIComponent(id)}/nsfw`, { method: 'POST', body: JSON.stringify({ nsfw }) });
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

  /** Send a video or sound file (at most 200 MB / 30 MB) for a maker to work on. */
  async uploadStudioMedia(file: Blob): Promise<StudioUpload> {
    return this.studioCall<StudioUpload>('/_orbit/studio/uploads', { method: 'POST', body: file, headers: { 'content-type': file.type || 'application/octet-stream' } });
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

  // ---- meme lab (made while the machine is unused; never keeps it on)

  private labAbsolute(st: MemeLabState): MemeLabState {
    return { ...st, making: st.making ? { ...st.making, job: st.making.job ? this.absoluteJob(st.making.job) : null } : null, records: st.records.map((r) => this.absolute(r)) };
  }

  async memeLab(): Promise<MemeLabState> {
    return this.labAbsolute(await this.studioCall<MemeLabState>('/_orbit/studio/lab'));
  }

  async setMemeLab(enabled: boolean): Promise<MemeLabState> {
    return this.labAbsolute(await this.studioCall<MemeLabState>('/_orbit/studio/lab', { method: 'POST', body: JSON.stringify({ enabled }) }));
  }

  async setLabStyle(style: LabStyle): Promise<MemeLabState> {
    return this.labAbsolute(await this.studioCall<MemeLabState>('/_orbit/studio/lab', { method: 'POST', body: JSON.stringify({ style }) }));
  }

  async setLabTopics(topics: string[]): Promise<MemeLabState> {
    return this.labAbsolute(await this.studioCall<MemeLabState>('/_orbit/studio/lab', { method: 'POST', body: JSON.stringify({ topics }) }));
  }

  /** Stop the lab video being made now. */
  async cancelLabVideo(): Promise<MemeLabState> {
    return this.labAbsolute(await this.studioCall<MemeLabState>('/_orbit/studio/lab/cancel', { method: 'POST', body: '{}' }));
  }

  /** Your own idea; it is made next. */
  async addLabIdea(idea: { title?: string; prompt: string }): Promise<MemeLabState> {
    return this.labAbsolute(await this.studioCall<MemeLabState>('/_orbit/studio/lab/queue', { method: 'POST', body: JSON.stringify(idea) }));
  }

  async editLabIdea(id: string, idea: { title?: string; prompt?: string }): Promise<MemeLabState> {
    return this.labAbsolute(await this.studioCall<MemeLabState>(`/_orbit/studio/lab/queue/${encodeURIComponent(id)}`, { method: 'POST', body: JSON.stringify(idea) }));
  }

  async makeLabIdeaNext(id: string): Promise<MemeLabState> {
    return this.labAbsolute(await this.studioCall<MemeLabState>(`/_orbit/studio/lab/queue/${encodeURIComponent(id)}/next`, { method: 'POST', body: '{}' }));
  }

  async removeLabIdea(id: string): Promise<MemeLabState> {
    return this.labAbsolute(await this.studioCall<MemeLabState>(`/_orbit/studio/lab/queue/${encodeURIComponent(id)}`, { method: 'DELETE' }));
  }

  /** Your style (for the Lab's "Your style"): the profile of your own saved prompts. */
  async labProfile(): Promise<YourStyleProfile> {
    return this.studioCall<YourStyleProfile>('/_orbit/studio/lab/profile');
  }

  /** Change your style: your summary steers it; removed chips stay out. */
  async editLabProfile(edit: { summary?: string; remove?: string[]; restore?: string[] }): Promise<YourStyleProfile> {
    return this.studioCall<YourStyleProfile>('/_orbit/studio/lab/profile', { method: 'POST', body: JSON.stringify(edit) });
  }

  /** Build your style again from your saved prompts now (it says building until done). */
  async rebuildLabProfile(): Promise<YourStyleProfile> {
    return this.studioCall<YourStyleProfile>('/_orbit/studio/lab/profile/rebuild', { method: 'POST', body: '{}' });
  }

  /** Move a meme-lab video into the gallery. */
  async keepMeme(id: string): Promise<MemeLabState> {
    return this.labAbsolute(await this.studioCall<MemeLabState>(`/_orbit/studio/lab/${encodeURIComponent(id)}/keep`, { method: 'POST', body: '{}' }));
  }

  async deleteMeme(id: string): Promise<MemeLabState> {
    return this.labAbsolute(await this.studioCall<MemeLabState>(`/_orbit/studio/lab/${encodeURIComponent(id)}`, { method: 'DELETE' }));
  }

  /** Add something made in the cloud (a data: URL or a cloud maker's https link) to the gallery. */
  async importCloudItem(body: { url: string; kind: 'image' | 'video'; prompt: string; maker: string }): Promise<StudioItem> {
    const r = await this.studioCall<{ item: StudioItem }>('/_orbit/studio/import', { method: 'POST', body: JSON.stringify(body) });
    return this.absolute(r.item);
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

  /**
   * Make what isn't done yet on the main or the helper machine (keeps going there while the phone
   * sleeps). `approve`: the storyboard looks right, go on to the shots.
   */
  runMovie(id: string, on: AiMachine = 'main', opts: { approve?: boolean } = {}): Promise<Movie> {
    return this.studioCall<Movie>(`/_orbit/studio/movies/${encodeURIComponent(id)}/run`, { method: 'POST', body: JSON.stringify(opts) }, on);
  }

  /** How long a movie like this takes on the AI machine, before it exists. */
  estimateMovie(draft: MovieDraft): Promise<MovieEstimate> {
    return this.studioCall<MovieEstimate>('/_orbit/studio/movies/estimate', { method: 'POST', body: JSON.stringify(draft) });
  }

  /** The AI writes (or rewrites) the story: shots, storyboard words, lead, look and sound. */
  planMovie(id: string): Promise<Movie> {
    return this.studioCall<Movie>(`/_orbit/studio/movies/${encodeURIComponent(id)}/plan`, { method: 'POST', body: '{}' });
  }

  /** A photo of the lead (data URL): the machine makes it the lead's reference picture. */
  movieLeadPhoto(id: string, photo: string): Promise<Movie> {
    return this.studioCall<Movie>(`/_orbit/studio/movies/${encodeURIComponent(id)}/lead`, { method: 'POST', body: JSON.stringify({ photo }) });
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
