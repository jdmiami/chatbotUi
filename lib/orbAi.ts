import 'server-only';

/**
 * Cloud AI for the orb: NVIDIA's free API (build.nvidia.com, OpenAI-compatible). The key
 * (NVIDIA_API_KEY) stays here on the server; the browser only ever talks to /api/orb/ai.
 * Quick jobs go here; heavy ones (pictures, videos, long chats) stay on the AI machine.
 */

export const NVIDIA_BASE = 'https://integrate.api.nvidia.com/v1';

export type OrbTask = 'fast' | 'agent' | 'vision' | 'write';
export const ORB_TASKS: OrbTask[] = ['fast', 'agent', 'vision', 'write'];

/** Best first; the next one is tried when a model is missing, busy or failing. */
const DEFAULT_MODELS: Record<OrbTask, string[]> = {
  fast: ['nvidia/nemotron-3.5-lightning-30b-a3b', 'google/gemma-4-31b-it'],
  agent: ['nvidia/nemotron-3-super-120b-a12b', 'z-ai/glm-5.3'],
  vision: ['nvidia/nemotron-3.5-super-vl-120b-a12b', 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning'],
  write: ['nvidia/nemotron-3.5-lightning-30b-a3b', 'google/gemma-4-31b-it'],
};

export function orbAiConfigured() {
  return Boolean(process.env.NVIDIA_API_KEY);
}

/** ORB_MODELS='{"agent":["z-ai/glm-5.3"]}' swaps models without a code change. */
export function orbModels(): Record<OrbTask, string[]> {
  const models = { ...DEFAULT_MODELS };
  try {
    const custom = JSON.parse(process.env.ORB_MODELS || '{}') as Partial<Record<OrbTask, unknown>>;
    for (const task of ORB_TASKS) {
      const list = custom[task];
      if (Array.isArray(list) && list.length && list.every((m) => typeof m === 'string')) models[task] = list as string[];
    }
  } catch {
    /* bad JSON: keep the defaults */
  }
  return models;
}

// Anything that looks like a key or token is blanked before it leaves for NVIDIA.
const SECRET_PATTERNS: RegExp[] = [
  /\bnvapi-[A-Za-z0-9_-]{10,}/g,
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

export async function callNvidia(model: string, body: Record<string, unknown>, signal: AbortSignal) {
  return fetch(`${NVIDIA_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.NVIDIA_API_KEY}`,
      'content-type': 'application/json',
      accept: body.stream ? 'text/event-stream' : 'application/json',
    },
    body: JSON.stringify({ ...body, model }),
    signal,
    cache: 'no-store',
  });
}
