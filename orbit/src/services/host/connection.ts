/**
 * Connection to the Linux machine (the "Orbit host").
 *
 * Orbit is served by the signed-in web app at /orbit. On start it asks that app for:
 *   POST /api/orbit/session -> { machine: {state, costPerHour, canControl}, hostUrl, token, expiresIn }
 * and then talks to the Orbit host on the Linux machine directly with that short-lived token
 * (kept in memory only, never in storage). When there is no web app (local dev / static preview)
 * Orbit runs in demo mode.
 */

export type MachineState = 'unconfigured' | 'off' | 'starting' | 'on' | 'error' | 'unknown';

export interface MachineStatus {
  state: MachineState;
  costPerHour: number | null;
  canControl: boolean;
  detail?: string;
}

export interface HostSession {
  hostUrl: string;
  token: string;
  expiresAt: number;
}

export type ConnectionCheck =
  | { kind: 'no-backend' } // static preview / local dev: demo only
  | { kind: 'signed-out' }
  | { kind: 'machine'; machine: MachineStatus; session: HostSession | null; reachable: boolean };

const SESSION_URL = '/api/orbit/session';
const MACHINE_URL = '/api/machine';

async function postSession(): Promise<Response | null> {
  try {
    return await fetch(SESSION_URL, { method: 'POST', credentials: 'same-origin', cache: 'no-store' });
  } catch {
    return null;
  }
}

/** Ask the web app for machine state + a host token, then check the host actually answers. */
export async function checkConnection(): Promise<ConnectionCheck> {
  const res = await postSession();
  if (!res || res.status === 404 || res.status === 405) return { kind: 'no-backend' };
  if (res.status === 401) return { kind: 'signed-out' };
  const ct = res.headers.get('content-type') ?? '';
  if (!res.ok || !ct.includes('json')) return { kind: 'no-backend' };
  const body = (await res.json()) as {
    machine: MachineStatus;
    hostUrl: string | null;
    token: string | null;
    expiresIn?: number;
  };
  const session =
    body.hostUrl && body.token
      ? { hostUrl: body.hostUrl, token: body.token, expiresAt: Date.now() + (body.expiresIn ?? 3600) * 1000 }
      : null;
  const reachable = session ? await hostReachable(session) : false;
  return { kind: 'machine', machine: body.machine, session, reachable };
}

async function hostReachable(session: HostSession): Promise<boolean> {
  try {
    const res = await fetch(`${session.hostUrl}/orbit/api/info`, {
      headers: { Authorization: `Bearer ${session.token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(6000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function setMachinePower(action: 'start' | 'stop'): Promise<MachineStatus> {
  const res = await fetch(MACHINE_URL, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as MachineStatus;
}

/**
 * Keeps a valid host token for the rest of the app. Refreshes a couple of minutes before
 * expiry, or immediately after a 401 from the host.
 */
export class TokenSource {
  private current: HostSession;
  private pending: Promise<HostSession> | null = null;

  constructor(initial: HostSession) {
    this.current = initial;
  }

  get hostUrl() {
    return this.current.hostUrl;
  }

  async token(forceRefresh = false): Promise<string> {
    if (!forceRefresh && this.current.expiresAt - Date.now() > 120_000) return this.current.token;
    this.pending ??= this.refresh().finally(() => (this.pending = null));
    return (await this.pending).token;
  }

  private async refresh(): Promise<HostSession> {
    const check = await checkConnection();
    if (check.kind === 'signed-out') {
      window.location.href = '/login';
      throw new Error('Signed out');
    }
    if (check.kind !== 'machine' || !check.session) throw new Error('The Linux machine is not available.');
    this.current = check.session;
    return this.current;
  }
}

/** fetch() against the Orbit host with auth, one automatic token refresh on 401, and JSON errors. */
export class HostClient {
  constructor(readonly tokens: TokenSource) {}

  get baseUrl() {
    return this.tokens.hostUrl;
  }

  async fetch(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
    const token = await this.tokens.token();
    const res = await fetch(`${this.baseUrl}/orbit/api${path}`, {
      ...init,
      cache: 'no-store',
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
    });
    if (res.status === 401 && retry) {
      await this.tokens.token(true);
      return this.fetch(path, init, false);
    }
    return res;
  }

  async json<T>(path: string, init: RequestInit = {}): Promise<T> {
    let res: Response;
    try {
      res = await this.fetch(path, init);
    } catch {
      throw new HostError('Could not reach the Linux machine. Check that it is on.', 0);
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new HostError(body.error ?? `Request failed (${res.status})`, res.status, body.code);
    return body as T;
  }

  /**
   * POST/GET a Server-Sent Events endpoint with fetch (EventSource can't send an Authorization header).
   * Calls onEvent for each event; resolves when the stream ends. Abort with the signal.
   */
  async stream(
    path: string,
    init: RequestInit & { signal?: AbortSignal },
    onEvent: (event: string, data: unknown) => void,
  ): Promise<void> {
    const res = await this.fetch(path, init);
    if (!res.ok || !res.body) {
      const body = await res.json().catch(() => ({}));
      throw new HostError(body.error ?? `Request failed (${res.status})`, res.status, body.code);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        let event = 'message';
        const data: string[] = [];
        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
        }
        if (data.length) {
          try {
            onEvent(event, JSON.parse(data.join('\n')));
          } catch {
            onEvent(event, data.join('\n'));
          }
        }
      }
    }
  }
}

export class HostError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'HostError';
  }
}
