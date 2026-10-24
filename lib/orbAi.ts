import 'server-only';

/**
 * Cloud AI: NVIDIA's free API first, then backup serverless providers (Groq, Gemini, Cerebras,
 * OpenRouter, Together), all OpenAI-compatible. Keys stay here on the server; the browser only ever talks to
 * /api/orb/ai. The orb's quick jobs go here, and AI app chats when the AI machine is off.
 */

export const NVIDIA_BASE = 'https://integrate.api.nvidia.com/v1';

/**
 * `chat` is a whole conversation in the AI app; the others are the orb's quick jobs. `free` is
 * unfiltered writing (Rewrite, Fill for me): models that follow the owner's text without refusing,
 * with one limit set on the server (freeWrite.ts).
 */
export type OrbTask = 'fast' | 'agent' | 'vision' | 'write' | 'chat' | 'free';
export const ORB_TASKS: OrbTask[] = ['fast', 'agent', 'vision', 'write', 'chat', 'free'];

export type ProviderId = 'nvidia' | 'groq' | 'gemini' | 'cerebras' | 'openrouter' | 'together';

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
 * Every serverless provider speaks the same OpenAI-style chat API, so a backup is just another
 * base URL and key. A provider is used when its key is set in Vercel; the order is ORB_PROVIDERS
 * (or this list), and Settings can put any one of them first. Model lists can be swapped without
 * a code change: ORB_MODELS for NVIDIA, ORB_MODELS_GROQ, ORB_MODELS_OPENROUTER and so on.
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
      free: ['nv-mistralai/mistral-nemo-12b-instruct', 'mistralai/mistral-large-2-instruct', 'mistralai/mistral-7b-instruct-v0.3'],
    },
  },
  {
    id: 'groq',
    name: 'Groq',
    base: 'https://api.groq.com/openai/v1',
    keyEnv: 'GROQ_API_KEY',
    models: {
      fast: ['llama-3.1-8b-instant', 'openai/gpt-oss-20b'],
      agent: ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile'],
      vision: ['meta-llama/llama-4-scout-17b-16e-instruct'],
      write: ['llama-3.3-70b-versatile', 'openai/gpt-oss-20b'],
      chat: ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b'],
      free: ['llama-3.3-70b-versatile'],
    },
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    base: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyEnv: 'GEMINI_API_KEY',
    models: {
      fast: ['gemini-2.5-flash-lite', 'gemini-2.5-flash'],
      agent: ['gemini-2.5-flash', 'gemini-2.5-flash-lite'],
      vision: ['gemini-2.5-flash', 'gemini-2.5-flash-lite'],
      write: ['gemini-2.5-flash-lite', 'gemini-2.5-flash'],
      chat: ['gemini-2.5-flash', 'gemini-2.5-flash-lite'],
      free: ['gemini-2.5-flash'],
    },
  },
  {
    id: 'cerebras',
    name: 'Cerebras',
    base: 'https://api.cerebras.ai/v1',
    keyEnv: 'CEREBRAS_API_KEY',
    models: {
      fast: ['llama3.1-8b', 'gpt-oss-120b'],
      agent: ['gpt-oss-120b', 'llama-3.3-70b'],
      vision: [],
      write: ['llama-3.3-70b', 'gpt-oss-120b'],
      chat: ['gpt-oss-120b', 'llama-3.3-70b'],
      free: ['llama-3.3-70b'],
    },
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    base: 'https://openrouter.ai/api/v1',
    keyEnv: 'OPENROUTER_API_KEY',
    models: {
      fast: ['meta-llama/llama-3.3-70b-instruct:free', 'openai/gpt-oss-20b:free'],
      agent: ['openai/gpt-oss-120b:free', 'deepseek/deepseek-chat-v3.1:free'],
      vision: ['qwen/qwen2.5-vl-72b-instruct:free', 'google/gemma-3-27b-it:free'],
      write: ['meta-llama/llama-3.3-70b-instruct:free', 'openai/gpt-oss-20b:free'],
      chat: ['deepseek/deepseek-chat-v3.1:free', 'meta-llama/llama-3.3-70b-instruct:free'],
      free: ['cognitivecomputations/dolphin-mistral-24b-venice-edition:free', 'mistralai/mistral-nemo:free'],
    },
  },
  {
    id: 'together',
    name: 'Together AI',
    base: 'https://api.together.xyz/v1',
    keyEnv: 'TOGETHER_API_KEY',
    models: {
      fast: ['meta-llama/Llama-3.3-70B-Instruct-Turbo-Free'],
      agent: ['meta-llama/Llama-3.3-70B-Instruct-Turbo-Free'],
      vision: ['meta-llama/Llama-Vision-Free'],
      write: ['meta-llama/Llama-3.3-70B-Instruct-Turbo-Free'],
      chat: ['meta-llama/Llama-3.3-70B-Instruct-Turbo-Free'],
      free: ['meta-llama/Llama-3.3-70B-Instruct-Turbo-Free'],
    },
  },
];

const configured = (p: Provider) => Boolean(process.env[p.keyEnv]);

function modelsFor(p: Provider): Record<OrbTask, string[]> {
  const models = { ...p.models };
  const env = p.id === 'nvidia' ? 'ORB_MODELS' : `ORB_MODELS_${p.id.toUpperCase()}`;
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

/** The providers with a key, in the order they are tried; `prefer` goes first. */
export function orbProviders(prefer?: string): Provider[] {
  const order = (process.env.ORB_PROVIDERS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const rank = (p: Provider) => (p.id === prefer ? -1 : order.includes(p.id) ? order.indexOf(p.id) : order.length + PROVIDERS.indexOf(p));
  return PROVIDERS.filter(configured)
    .filter((p) => !order.length || order.includes(p.id) || p.id === prefer)
    .sort((a, b) => rank(a) - rank(b));
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
      // OpenRouter shows where requests come from; harmless elsewhere.
      ...(provider.id === 'openrouter' ? { 'x-title': 'Orbit' } : {}),
    },
    body: JSON.stringify({ ...payload, model }),
    signal,
    cache: 'no-store',
  });
}
