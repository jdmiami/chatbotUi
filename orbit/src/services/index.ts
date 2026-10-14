/**
 * Service registry: the single place that decides which implementation each app gets.
 * Phase 1 wires demo/browser-local implementations. Phase 2 swaps these for server-backed
 * adapters (PTY, file API, agy CLI) without changing the apps.
 */
import type { FileStore } from './files/types';
import type { RunnerAdapter } from './runner/types';
import type { TerminalBackend } from './terminal/types';
import { LocalFileStore } from './files/local/LocalFileStore';
import { SimulatedShell } from './terminal/simulated/SimulatedShell';
import { DemoRunner } from './runner/demo/DemoRunner';

export type ConnectionMode = 'demo';

/** Orbit is not connected to any server in Phase 1. Never report anything else. */
export const connection: { mode: ConnectionMode; label: string; detail: string } = {
  mode: 'demo',
  label: 'Demo mode',
  detail:
    'Not connected to an Ubuntu host. The terminal and Antigravity responses are simulated; files are stored in this browser only.',
};

let fileStore: LocalFileStore | null = null;
export function getFileStore(): FileStore & { reset(): void } {
  fileStore ??= new LocalFileStore();
  return fileStore;
}

let runner: DemoRunner | null = null;
export function getRunner(): RunnerAdapter & { reset(): void } {
  runner ??= new DemoRunner();
  return runner;
}

/** Each terminal tab gets its own backend instance. */
export function createTerminalBackend(): TerminalBackend {
  return new SimulatedShell(getFileStore());
}

/** Settings → "Reset demo data". */
export function resetDemoData() {
  getFileStore().reset();
  getRunner().reset();
}
