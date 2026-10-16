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
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface StreamHandlers {
  onText(delta: string): void;
  /** The model's visible reasoning ("thinking"), when it sends it. */
  onReasoning?(delta: string): void;
}

export class AiError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
  }
}

interface Grant {
  url: string;
  token: string;
  expires: number;
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
        let msg: { choices?: { delta?: { content?: string; reasoning?: string; reasoning_content?: string } }[]; error?: { message?: string } };
        try {
          msg = JSON.parse(data);
        } catch {
          continue;
        }
        if (msg.error) throw new AiError(msg.error.message ?? 'The model reported an error.');
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

  power(action: 'start' | 'stop'): Promise<AiMachineStatus> {
    return siteJson<AiMachineStatus>('/api/ai', { method: 'POST', body: JSON.stringify({ action }) });
  }

  /** Address + token of the AI machine; null while it isn't ready. */
  private async access(force = false): Promise<Grant | null> {
    if (!force && this.grant && this.grant.expires - Date.now() > 120_000) return this.grant;
    const r = await siteJson<{ url: string | null; token: string | null; expiresIn: number }>('/api/ai/token', {
      method: 'POST',
      body: '{}',
    });
    this.grant = r.url && r.token ? { url: r.url, token: r.token, expires: Date.now() + r.expiresIn * 1000 } : null;
    return this.grant;
  }

  private async call(path: string, init: RequestInit, retry = true): Promise<Response> {
    const g = await this.access();
    if (!g) throw new AiError('Your AI machine is not on yet.', 503);
    const res = await fetch(`${g.url}${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), authorization: `Bearer ${g.token}` },
    }).catch((err: Error) => {
      if (init.signal?.aborted) throw err;
      throw new AiError('Could not reach your AI machine. It may be starting or just turned itself off.');
    });
    if (res.status === 401 && retry) {
      await this.access(true);
      return this.call(path, init, false);
    }
    return res;
  }

  async listModels(): Promise<string[]> {
    const res = await this.call('/v1/models', { method: 'GET' });
    if (!res.ok) throw new AiError(`Models: ${res.status}`, res.status);
    const body = (await res.json()) as { data?: { id: string }[] };
    return (body.data ?? []).map((m) => m.id).sort();
  }

  /** Stream one reply. Resolves when the model is done (or the signal aborts). */
  async chat(model: string, messages: ChatMessage[], h: StreamHandlers, signal?: AbortSignal): Promise<void> {
    const res = await this.call('/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: true }),
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
