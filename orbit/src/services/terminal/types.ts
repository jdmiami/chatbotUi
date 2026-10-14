/**
 * Terminal backend contract.
 *
 * Phase 1: `SimulatedShell` (services/terminal/simulated) runs entirely in the browser.
 * Phase 2: a `PtyBackend` will speak to an authenticated server-side PTY over a WebSocket.
 * The Terminal app only talks to this interface, so the swap does not touch the UI.
 */

export type TerminalStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error';

export interface TerminalSize {
  cols: number;
  rows: number;
}

export interface TerminalBackend {
  /** 'simulated' = no real shell; the UI must say so. 'pty' = a real server-side PTY. */
  readonly kind: 'simulated' | 'pty';
  /** Short human label, e.g. "Simulated shell — runs in this browser". */
  readonly label: string;

  /** Start (or resume) the session. Resolves once output can flow. */
  connect(size: TerminalSize): Promise<void>;
  /** Raw input from the terminal emulator (keystrokes, pasted text, escape sequences). */
  write(data: string): void;
  /** Viewport changed (rotation, split view, keyboard). */
  resize(size: TerminalSize): void;
  /** Output to render. Returns an unsubscribe function. */
  onOutput(listener: (data: string) => void): () => void;
  /** Connection lifecycle. Returns an unsubscribe function. */
  onStatus(listener: (status: TerminalStatus, detail?: string) => void): () => void;
  /** Close the connection. A PTY backend may keep the server-side session alive for reconnects. */
  disconnect(): void;
}
