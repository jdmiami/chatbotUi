import 'server-only';

/**
 * Cloud AI: NVIDIA's API with open-weight models only (models whose weights are published, the same
 * kind you could run on your own machine). Every chat and every writing job on the site goes here.
 * The key stays on the server; the browser only ever talks to /api/orb/ai.
 */

export const NVIDIA_BASE = 'https://integrate.api.nvidia.com/v1';

/**
 * `chat` is a whole conversation in the AI app; the others are the orb's quick jobs. `free` is
 * unfiltered writing (Rewrite, Fill for me): models that follow the owner's text without refusing,
 * with one limit set on the server (freeWrite.ts).
 */
export type OrbTask = 'fast' | 'agent' | 'vision' | 'write' | 'chat' | 'free';
export const ORB_TASKS: OrbTask[] = ['fast', 'agent', 'vision', 'write', 'chat', 'free'];

export type ProviderId = 'nvidia';

interface Provider {
  id: ProviderId;
  name: string;
  base: string;
  keyEnv: string;
  /** Best first; the next one is tried when a model is missing, busy or failing. */
  models: Record<OrbTask, string[]>;
  /** NVIDIA's reasoning models take a switch to answer straight away. */
  noThinking?: boolean;
}

/**
 * NVIDIA only, open weights only: no closed models and no other companies. A model is skipped for
 * the next one when it is missing, busy or failing. The lists can be swapped without a code change
 * with ORB_MODELS (keep them open-weight).
 */
const PROVIDERS: Provider[] = [
  {
    id: 'nvidia',
    name: 'NVIDIA',
    base: NVIDIA_BASE,
    keyEnv: 'NVIDIA_API_KEY',
    noThinking: true,
    models: {
      fast: ['nvidia/nemotron-3.5-lightning-30b-a3b', 'google/gemma-4-31b-it'],
      agent: ['nvidia/nemotron-3-super-120b-a12b', 'z-ai/glm-5.3'],
      vision: ['nvidia/nemotron-3.5-super-vl-120b-a12b', 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning'],
      write: ['nvidia/nemotron-3.5-lightning-30b-a3b', 'google/gemma-4-31b-it'],
      chat: ['nvidia/nemotron-3-super-120b-a12b', 'z-ai/glm-5.3', 'google/gemma-4-31b-it'],
      // Unfiltered writing: the three that have done it first, then more of NVIDIA's free list (as its
      // /v1/models listed them on 2026-11-05), tried in this order when one turns a request down.
      free: [
        'nv-mistralai/mistral-nemo-12b-instruct',
        'mistralai/mistral-large-2-instruct',
        'mistralai/mistral-7b-instruct-v0.3',
        'mistralai/mistral-large-4-1t-a52b',
        'nvidia/mistral-nemo-minitron-8b-8k-instruct',
        'deepseek-ai/deepseek-v4.1-flash',
        'z-ai/glm-5.3-flash',
        'moonshotai/kimi-k2.6',
      ],
    },
  },
];

const configured = (p: Provider) => Boolean(process.env[p.keyEnv]);

function modelsFor(p: Provider): Record<OrbTask, string[]> {
  const models = { ...p.models };
  const env = 'ORB_MODELS';
  try {
    const custom = JSON.parse(process.env[env] || '{}') as Partial<Record<OrbTask, unknown>>;
    for (const task of ORB_TASKS) {
      const list = custom[task];
      if (Array.isArray(list) && list.length && list.every((m) => typeof m === 'string')) models[task] = list as string[];
    }
  } catch {
    /* bad JSON: keep the defaults */
  }
  return models;
}

/** The providers with a key (NVIDIA only). `prefer` is kept for old callers and changes nothing. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function orbProviders(prefer?: string): Provider[] {
  return PROVIDERS.filter(configured);
}

export function orbAiConfigured() {
  return PROVIDERS.some(configured);
}

/** What the site may tell the browser: which providers are set up, in order, and their models. Never a key. */
export function orbAiInfo(prefer?: string) {
  const list = orbProviders(prefer);
  return {
    configured: list.length > 0,
    providers: list.map((p) => ({ id: p.id, name: p.name })),
    models: Object.fromEntries(ORB_TASKS.map((t) => [t, list.flatMap((p) => modelsFor(p)[t])])) as Record<OrbTask, string[]>,
    // Each provider's own models for each job (the fast Make page lets you pick NVIDIA's writer).
    byProvider: list.map((p) => ({ id: p.id, name: p.name, models: modelsFor(p) })),
  };
}

/** Models for each job, every provider's in order (the first provider's first). */
export function orbModels(prefer?: string): Record<OrbTask, string[]> {
  return orbAiInfo(prefer).models;
}

export interface Attempt {
  provider: Provider;
  model: string;
}

/** Every (provider, model) to try for a job, in order. `model` pins one. */
export function attempts(task: OrbTask, prefer?: string, model?: string): Attempt[] {
  const out: Attempt[] = [];
  for (const provider of orbProviders(prefer)) {
    for (const m of modelsFor(provider)[task]) if (!model || m === model) out.push({ provider, model: m });
  }
  return out;
}

// Anything that looks like a key or token is blanked before it leaves for a provider.
const SECRET_PATTERNS: RegExp[] = [
  /\bnvapi-[A-Za-z0-9_-]{10,}/g,
  /\bgsk_[A-Za-z0-9]{20,}/g,
  /\bAIza[A-Za-z0-9_-]{30,}/g,
  /\bcsk-[A-Za-z0-9]{20,}/g,
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}/g,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:rpa|rp)_[A-Za-z0-9]{20,}/g,
  /\b[a-f0-9]{40,}\b/gi,
  /\b(password|passwd|secret|token|api[_-]?key)\s*[:=]\s*\S+/gi,
];

export function redact(text: string): string {
  let out = text;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, (m, label?: string) => (typeof label === 'string' && /^[a-z_-]+$/i.test(label) ? `${label}: [hidden]` : '[hidden]'));
  }
  return out;
}

type Part = { type: string; text?: string; image_url?: { url: string } };
export interface OrbMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | Part[];
  tool_call_id?: string;
  tool_calls?: unknown;
}

const MAX_CHARS = 120_000;
const MAX_IMAGES = 4;

/** Checks the shape, redacts secrets and caps the size. Returns an error message when bad. */
export function cleanMessages(input: unknown): OrbMessage[] | string {
  if (!Array.isArray(input) || !input.length || input.length > 60) return 'messages must be a list of 1–60 items';
  let chars = 0;
  let images = 0;
  const out: OrbMessage[] = [];
  for (const raw of input as Record<string, unknown>[]) {
    const role = raw?.role;
    if (role !== 'system' && role !== 'user' && role !== 'assistant' && role !== 'tool') return 'bad message role';
    let content: OrbMessage['content'];
    // An assistant turn that only calls tools has no text.
    if ((raw.content === null || raw.content === undefined) && raw.tool_calls) {
      content = '';
    } else if (typeof raw.content === 'string') {
      content = redact(raw.content);
      chars += content.length;
    } else if (Array.isArray(raw.content)) {
      const parts: Part[] = [];
      for (const p of raw.content as Part[]) {
        if (p?.type === 'text' && typeof p.text === 'string') {
          const text = redact(p.text);
          chars += text.length;
          parts.push({ type: 'text', text });
        } else if (p?.type === 'image_url' && typeof p.image_url?.url === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(p.image_url.url)) {
          if (++images > MAX_IMAGES) return `at most ${MAX_IMAGES} pictures`;
          parts.push({ type: 'image_url', image_url: { url: p.image_url.url } });
        } else return 'bad message part';
      }
      content = parts;
    } else return 'bad message content';
    if (chars > MAX_CHARS) return 'that is too much text for one request';
    const msg: OrbMessage = { role, content };
    if (typeof raw.tool_call_id === 'string') msg.tool_call_id = raw.tool_call_id;
    if (raw.tool_calls) msg.tool_calls = raw.tool_calls;
    out.push(msg);
  }
  return out;
}

/** Which failures move on to the next model rather than giving up. */
export function retryable(status: number) {
  return status === 404 || status === 408 || status === 409 || status === 422 || status === 429 || status >= 500;
}

export async function callProvider({ provider, model }: Attempt, body: Record<string, unknown>, signal: AbortSignal) {
  const { chat_template_kwargs, ...rest } = body;
  const payload = provider.noThinking && chat_template_kwargs ? body : rest;
  return fetch(`${provider.base}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env[provider.keyEnv]}`,
      'content-type': 'application/json',
      accept: body.stream ? 'text/event-stream' : 'application/json',
    },
    body: JSON.stringify({ ...payload, model }),
    signal,
    cache: 'no-store',
  });
}
