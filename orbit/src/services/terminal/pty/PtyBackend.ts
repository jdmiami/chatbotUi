import { HostError, type HostClient } from '../../host/connection';
import type { TerminalBackend, TerminalSize, TerminalStatus } from '../types';

/**
 * Real terminal: a WebSocket to the Orbit host's PTY (/orbit/pty). The shell runs inside tmux on
 * the Linux machine, so dropping the connection (network change, locking the phone, switching to
 * the iPad) does not end it. On unexpected disconnects this backend reconnects with backoff and
 * re-attaches to the same tmux session.
 */
export class PtyBackend implements TerminalBackend {
  readonly kind = 'pty' as const;
  readonly label = 'Linux machine · session kept running in tmux';

  private ws: WebSocket | null = null;
  private size: TerminalSize = { cols: 80, rows: 24 };
  private outputListeners = new Set<(data: string) => void>();
  private statusListeners = new Set<(s: TerminalStatus, d?: string) => void>();
  private wantOpen = false;
  private attempts = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  persistent = true;
  /** Why the last connection ended: the shell itself exited, or the connection was closed. */
  lastDisconnect: 'shell-exited' | 'closed' | null = null;
  /** Keys typed while reconnecting, sent once the shell is back (capped so a stuck key can't pile up). */
  private pendingInput = '';
  private static readonly MAX_PENDING = 4096;
  private detachFocus: (() => void) | null = null;
  private readonly scrollbackListeners = new Set<(active: boolean) => void>();

  constructor(
    private readonly host: HostClient,
    readonly session = 'main',
  ) {}

  async connect(size: TerminalSize): Promise<void> {
    this.size = size;
    this.wantOpen = true;
    this.attempts = 0;
    await this.open('connecting');
  }

  private async open(status: TerminalStatus) {
    this.setStatus(status);
    let token: string;
    try {
      token = await this.host.tokens.token();
    } catch (err) {
      this.setStatus('error', (err as Error).message);
      return;
    }
    const url = new URL(this.host.baseUrl.replace(/^http/, 'ws') + '/orbit/pty');
    url.searchParams.set('session', this.session);
    url.searchParams.set('cols', String(this.size.cols));
    url.searchParams.set('rows', String(this.size.rows));
    const ws = new WebSocket(url.toString());
    this.ws = ws;
    let ready = false;
    // A socket that opens but never says 'ready' would leave us "connecting" forever: retry instead.
    const readyTimer = setTimeout(() => {
      if (!ready && this.ws === ws) ws.close();
    }, 15_000);

    ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token }));
    ws.onmessage = (ev) => {
      let msg: { type: string; data?: string; message?: string; persistent?: boolean; code?: number; active?: boolean };
      try {
        msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
      } catch {
        return;
      }
      if (msg.type === 'ready') {
        ready = true;
        clearTimeout(readyTimer);
        this.attempts = 0;
        this.lastDisconnect = null;
        this.persistent = msg.persistent !== false;
        this.setStatus('connected');
        // Make sure the remote PTY matches the current viewport after a reconnect.
        this.send({ type: 'resize', cols: this.size.cols, rows: this.size.rows });
        if (this.pendingInput) {
          this.send({ type: 'input', data: this.pendingInput });
          this.pendingInput = '';
        }
        this.watchFocus();
      } else if (msg.type === 'output' && msg.data) {
        this.outputListeners.forEach((l) => l(msg.data!));
      } else if (msg.type === 'scrollback') {
        this.scrollbackListeners.forEach((l) => l(!!msg.active));
      } else if (msg.type === 'error') {
        this.setStatus('error', msg.message);
      } else if (msg.type === 'exit') {
        // The shell itself ended (e.g. `exit` typed, or tmux session killed).
        this.wantOpen = false;
        this.lastDisconnect = 'shell-exited';
        this.setStatus('disconnected', 'The shell ended.');
      }
    };
    ws.onclose = (ev) => {
      clearTimeout(readyTimer);
      if (this.ws !== ws) return;
      this.ws = null;
      if (ev.code === 4401) {
        this.wantOpen = false;
        this.setStatus('error', 'Not authorised. Reload Orbit to sign in again.');
        return;
      }
      if (!this.wantOpen) {
        if (!ready) this.setStatus('disconnected');
        return;
      }
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect() {
    this.attempts += 1;
    if (this.attempts > 8) {
      this.wantOpen = false;
      this.setStatus('error', 'Lost the connection to the Linux machine. Check it is on, then reconnect.');
      return;
    }
    const delay = Math.min(15_000, 500 * 2 ** (this.attempts - 1));
    this.setStatus('reconnecting', `Reconnecting (attempt ${this.attempts})…`);
    this.retryTimer = setTimeout(() => void this.open('reconnecting'), delay);
  }

  write(data: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.send({ type: 'input', data });
    } else if (this.wantOpen) {
      // Reconnecting: keep what was typed instead of silently dropping it.
      this.pendingInput = (this.pendingInput + data).slice(-PtyBackend.MAX_PENDING);
    }
  }

  /**
   * The same tmux session can be open on the iPhone and the iPad; tmux sizes the window for the most
   * recently used one. When this device comes back into view, re-send its size so it takes over.
   */
  private watchFocus() {
    if (this.detachFocus || typeof window === 'undefined') return;
    const nudge = () => {
      if (document.visibilityState === 'visible') this.send({ type: 'resize', cols: this.size.cols, rows: this.size.rows });
    };
    window.addEventListener('focus', nudge);
    document.addEventListener('visibilitychange', nudge);
    this.detachFocus = () => {
      window.removeEventListener('focus', nudge);
      document.removeEventListener('visibilitychange', nudge);
    };
  }

  resize(size: TerminalSize): void {
    this.size = size;
    this.send({ type: 'resize', cols: size.cols, rows: size.rows });
  }

  onOutput(listener: (data: string) => void): () => void {
    this.outputListeners.add(listener);
    return () => this.outputListeners.delete(listener);
  }

  onStatus(listener: (status: TerminalStatus, detail?: string) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  disconnect(): void {
    this.wantOpen = false;
    this.pendingInput = '';
    this.detachFocus?.();
    this.detachFocus = null;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    const ws = this.ws;
    this.ws = null;
    ws?.close(1000);
    if (this.lastDisconnect !== 'shell-exited') this.lastDisconnect = 'closed';
    this.setStatus('disconnected');
  }

  /**
   * Scroll by touch (lines < 0 = back). The machine decides what that means for what's on screen:
   * the shell's history, or the keys/mouse wheel the running full-screen program scrolls with.
   */
  scroll(lines: number): void {
    if (lines) this.send({ type: 'scroll', lines: Math.round(lines) });
  }

  /** Leave the shell's history view and show the live screen. */
  scrollToLatest(): void {
    this.send({ type: 'scroll', to: 'bottom' });
  }

  /** Whether the shell's history view is showing (after scrolling back). */
  onScrollback(listener: (active: boolean) => void): () => void {
    this.scrollbackListeners.add(listener);
    return () => this.scrollbackListeners.delete(listener);
  }

  /** The session's whole scrollback as plain text, kept by tmux on the machine (survives reconnects). */
  async history(): Promise<string> {
    const body = await this.host.json<{ text: string }>(`/terminal/sessions/${encodeURIComponent(this.session)}/history`);
    return body.text;
  }

  /** End the tmux session on the machine for good, so the next connect starts a fresh shell. */
  async endSession(): Promise<void> {
    const res = await this.host.fetch(`/terminal/sessions/${encodeURIComponent(this.session)}`, { method: 'DELETE' });
    // 404 = no such session, which is what we wanted anyway.
    if (!res.ok && res.status !== 404) {
      const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
      throw new HostError(body.error ?? `Couldn't end the terminal session (${res.status})`, res.status, body.code);
    }
  }

  private send(msg: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private setStatus(status: TerminalStatus, detail?: string) {
    this.statusListeners.forEach((l) => l(status, detail));
  }
}
