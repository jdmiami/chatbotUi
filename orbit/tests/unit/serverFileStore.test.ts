import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServerFileStore } from '../../src/services/files/server/ServerFileStore';
import type { HostClient } from '../../src/services/host/connection';

/** A fake machine whose file listing and fingerprint we control. */
function fakeHost() {
  const state = { files: [{ path: 'a.txt', size: 1, updatedAt: 1 }], fingerprint: 'f1' };
  const calls: string[] = [];
  const host = {
    json: vi.fn(async (path: string) => {
      calls.push(path);
      if (path === '/files?fingerprint=1') return { fingerprint: state.fingerprint };
      if (path === '/files') return { root: 'projects', files: state.files, truncated: false, fingerprint: state.fingerprint };
      throw new Error(`unexpected ${path}`);
    }),
  };
  return { host: host as unknown as HostClient, state, calls };
}

afterEach(() => vi.useRealTimers());

describe('ServerFileStore polling', () => {
  it('checks a small fingerprint and downloads the listing only when something changed', async () => {
    vi.useFakeTimers();
    const { host, state, calls } = fakeHost();
    const store = new ServerFileStore(host);
    await store.list();
    const changed = vi.fn();
    const off = store.subscribe(changed);

    await vi.advanceTimersByTimeAsync(8000 * 3);
    expect(calls.filter((c) => c === '/files')).toHaveLength(1); // only the first list()
    expect(calls.filter((c) => c === '/files?fingerprint=1')).toHaveLength(3);
    expect(changed).not.toHaveBeenCalled();

    // Something changed on the machine.
    state.files = [...state.files, { path: 'b.txt', size: 2, updatedAt: 2 }];
    state.fingerprint = 'f2';
    await vi.advanceTimersByTimeAsync(8000);
    expect(calls.filter((c) => c === '/files')).toHaveLength(2);
    expect(changed).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(8000);
    expect(calls.filter((c) => c === '/files')).toHaveLength(2); // nothing new
    off();
  });
});
