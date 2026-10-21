import { AiError, readChatStream, type ChatMessage, type StreamHandlers } from './LocalAi';
import { useShell } from '../../state/shell';

/**
 * Cloud AI: NVIDIA's free models first, then backup serverless providers, reached through the site
 * (/api/orb/ai) so no key ever comes near the browser. Quick jobs (the orb planning a step,
 * rewriting a sentence, reading a screenshot) go here, and AI app chats while the AI machine is off.
 */

export type CloudTask = 'fast' | 'agent' | 'vision' | 'write' | 'chat';

export interface CloudStatus {
  configured: boolean;
  /** The providers set up on the site, in the order they are tried. */
  providers?: { id: string; name: string }[];
  models: Record<CloudTask, string[]>;
}

export interface CloudChat {
  task: CloudTask;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

const ENDPOINT = '/api/orb/ai';
let cached: { at: number; status: CloudStatus | null } | null = null;

/** Turned on in Settings (unset = on). */
export function cloudAiEnabled() {
  return useShell.getState().settings.cloudAi !== false;
}

export async function cloudStatus(fresh = false): Promise<CloudStatus | null> {
  if (!fresh && cached && Date.now() - cached.at < 60_000) return cached.status;
  let status: CloudStatus | null = null;
  try {
    const prefer = cloudPrefer();
    const res = await fetch(prefer ? `${ENDPOINT}?prefer=${encodeURIComponent(prefer)}` : ENDPOINT, { cache: 'no-store', credentials: 'same-origin' });
    if (res.ok) status = (await res.json()) as CloudStatus;
  } catch {
    /* offline */
  }
  cached = { at: Date.now(), status };
  return status;
}

/** Can the orb use cloud AI right now (switched on and set up on the site)? */
export async function cloudReady() {
  return cloudAiEnabled() && Boolean((await cloudStatus())?.configured);
}

/** The provider to try first (Settings); the others are the backups. Unset: the site's order. */
export function cloudPrefer(): string | undefined {
  return useShell.getState().settings.cloudPrefer || undefined;
}

async function post(body: Record<string, unknown>, signal?: AbortSignal) {
  const prefer = cloudPrefer();
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(prefer ? { ...body, prefer } : body),
    cache: 'no-store',
    credentials: 'same-origin',
    signal,
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    if (res.status === 401) throw new AiError('Your sign-in expired. Reload to sign in again.', 401);
    throw new AiError(err.error ?? `Cloud AI answered ${res.status}.`, res.status);
  }
  return res;
}

/** Stream one reply. Resolves with the model that answered. */
export async function cloudChat(req: CloudChat, h: StreamHandlers): Promise<string> {
  const res = await post(
    { task: req.task, messages: req.messages, max_tokens: req.maxTokens, temperature: req.temperature, stream: true },
    req.signal,
  );
  const model = res.headers.get('x-orb-model') ?? '';
  if (res.body) await readChatStream(res.body, h, req.signal);
  return model;
}

/** One whole reply as text (no streaming). */
export async function cloudText(req: CloudChat): Promise<string> {
  const res = await post(
    { task: req.task, messages: req.messages, max_tokens: req.maxTokens, temperature: req.temperature },
    req.signal,
  );
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content ?? '';
}
