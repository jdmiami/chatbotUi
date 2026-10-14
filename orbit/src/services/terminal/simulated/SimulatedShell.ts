import type { FileStore } from '../../files/types';
import type { TerminalBackend, TerminalSize, TerminalStatus } from '../types';

/** PLACEHOLDER — replaced by the real simulated shell. */
export class SimulatedShell implements TerminalBackend {
  readonly kind = 'simulated' as const;
  readonly label = 'Simulated shell — runs in this browser';
  constructor(_files: FileStore) {}
  async connect(_size: TerminalSize) {}
  write(_data: string) {}
  resize(_size: TerminalSize) {}
  onOutput(_l: (data: string) => void) {
    return () => {};
  }
  onStatus(_l: (s: TerminalStatus, d?: string) => void) {
    return () => {};
  }
  disconnect() {}
}
