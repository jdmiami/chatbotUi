import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PtyBackend } from '../../src/services/terminal/pty/PtyBackend';
import type { HostClient } from '../../src/services/host/connection';

/** A stand-in for the browser WebSocket that records what the backend sends. */
class FakeSocket {
  static OPEN = 1;
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
    this.onclose?.({ code: 1006 });
  }
  /** The machine accepts the connection and says the shell is ready. */
  accept() {
    this.readyState = 1;
    this.onopen?.();
    this.onmessage?.({ data: JSON.stringify({ type: 'ready', persistent: true }) });
  }
  inputs() {
    return this.sent.filter((m) => m.type === 'input').map((m) => m.data);
  }
}

const host = {
  baseUrl: 'https://machine.example',
  tokens: { token: async () => 'tok' },
} as unknown as HostClient;

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  FakeSocket.all = [];
  vi.stubGlobal('WebSocket', FakeSocket);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('PtyBackend', () => {
  it('keeps keys typed while reconnecting and sends them once the shell is back', async () => {
    vi.useFakeTimers();
    const pty = new PtyBackend(host);
    await pty.connect({ cols: 80, rows: 24 });
    FakeSocket.all[0].accept();
    pty.write('ls\r');
    expect(FakeSocket.all[0].inputs()).toEqual(['ls\r']);

    // The connection drops (phone locked, network change); the owner keeps typing.
    FakeSocket.all[0].close();
    pty.write('echo ');
    pty.write('back\r');
    await vi.advanceTimersByTimeAsync(600); // first reconnect attempt
    const second = FakeSocket.all[1];
    expect(second).toBeTruthy();
    second.accept();
    expect(second.inputs()).toEqual(['echo back\r']);
    // The size is re-sent before the queued keys, so the shell draws them at the right width.
    expect(second.sent.findIndex((m) => m.type === 'resize')).toBeLessThan(second.sent.findIndex((m) => m.type === 'input'));
    pty.disconnect();
  });

  it('does not keep typing around after the owner disconnects', async () => {
    const pty = new PtyBackend(host);
    await pty.connect({ cols: 80, rows: 24 });
    FakeSocket.all[0].accept();
    pty.disconnect();
    pty.write('rm -rf build\r');
    await flush();
    expect(FakeSocket.all).toHaveLength(1);
    expect(FakeSocket.all[0].inputs()).toEqual([]);
  });

  it('re-sends its size when the page comes back into view (the device being looked at wins)', async () => {
    const pty = new PtyBackend(host);
    await pty.connect({ cols: 100, rows: 30 });
    FakeSocket.all[0].accept();
    const before = FakeSocket.all[0].sent.filter((m) => m.type === 'resize').length;
    window.dispatchEvent(new Event('focus'));
    const after = FakeSocket.all[0].sent.filter((m) => m.type === 'resize');
    expect(after.length).toBe(before + 1);
    expect(after.at(-1)).toMatchObject({ cols: 100, rows: 30 });
    pty.disconnect();
    window.dispatchEvent(new Event('focus'));
    expect(FakeSocket.all[0].sent.filter((m) => m.type === 'resize').length).toBe(after.length);
  });
});
