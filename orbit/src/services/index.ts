/**
 * Service registry: the single place that decides which implementation each app gets.
 *
 * Orbit decides its mode once at start-up (see shell/Boot.tsx) BEFORE any app mounts:
 *  - 'host': connected to the Linux machine → real PTY terminal, real project files, real agy runner.
 *  - 'demo': no machine (off, not set up, or a static preview) → simulated terminal, files in this
 *    browser, canned Antigravity replies. Everything is labelled as simulated.
 * Apps only talk to the interfaces, so they never need to know which mode they're in, but they
 * can read `connection` to label themselves honestly.
 */
import type { FileStore } from './files/types';
import type { RunnerAdapter } from './runner/types';
import type { TerminalBackend } from './terminal/types';
import { LocalFileStore } from './files/local/LocalFileStore';
import { SimulatedShell } from './terminal/simulated/SimulatedShell';
import { DemoRunner } from './runner/demo/DemoRunner';
import { ServerFileStore } from './files/server/ServerFileStore';
import { PtyBackend } from './terminal/pty/PtyBackend';
import { HostRunner } from './runner/host/HostRunner';
import { HostClient, TokenSource, type HostSession } from './host/connection';
import { startInputReport } from './host/inputReport';

export type ConnectionMode = 'demo' | 'host';

export interface ConnectionInfo {
  mode: ConnectionMode;
  label: string;
  detail: string;
  /** Why we're in demo mode (machine off, not set up, static preview…). */
  demoReason?: 'machine-off' | 'no-backend' | 'unreachable' | 'chosen';
}

export const connection: ConnectionInfo = {
  mode: 'demo',
  label: 'Demo mode',
  detail:
    'Not connected to your Linux machine. The terminal and Antigravity responses are simulated; files are stored in this browser only.',
};

let host: HostClient | null = null;
let stopInputReport: (() => void) | null = null;
let fileStore: (FileStore & { reset(): void }) | null = null;
let runner: (RunnerAdapter & { reset(): void }) | null = null;

/** Called once by Boot before the shell renders. */
export function configureServices(
  mode: ConnectionMode,
  opts: { session?: HostSession; demoReason?: ConnectionInfo['demoReason'] } = {},
) {
  fileStore = null;
  runner = null;
  host = null;
  stopInputReport?.();
  stopInputReport = null;
  if (mode === 'host' && opts.session) {
    host = new HostClient(new TokenSource(opts.session));
    stopInputReport = startInputReport(host);
    Object.assign(connection, {
      mode: 'host',
      label: 'Linux machine',
      detail: 'Connected to your Linux machine. Terminal, files and Antigravity are real.',
      demoReason: undefined,
    } satisfies ConnectionInfo);
  } else {
    Object.assign(connection, {
      mode: 'demo',
      label: 'Demo mode',
      detail:
        opts.demoReason === 'machine-off'
          ? 'Your Linux machine is off, so Orbit is in demo mode. Turn it on to use the real terminal, files and Antigravity.'
          : 'Not connected to your Linux machine. The terminal and Antigravity responses are simulated; files are stored in this browser only.',
      demoReason: opts.demoReason,
    } satisfies ConnectionInfo);
  }
}

export function getHostClient(): HostClient | null {
  return host;
}

export function getFileStore(): FileStore & { reset(): void } {
  fileStore ??= host ? new ServerFileStore(host) : new LocalFileStore();
  return fileStore;
}

export function getRunner(): RunnerAdapter & { reset(): void } {
  runner ??= host ? new HostRunner(host) : new DemoRunner();
  return runner;
}

/** Each terminal tab gets its own backend instance. */
export function createTerminalBackend(): TerminalBackend {
  return host ? new PtyBackend(host) : new SimulatedShell(getFileStore());
}

/** Settings → "Reset demo data" (browser-local demo data only; never touches the machine). */
export function resetDemoData() {
  new LocalFileStore().reset();
  new DemoRunner().reset();
}
