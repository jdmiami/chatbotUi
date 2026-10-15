import { describe, expect, it, vi } from 'vitest';
import { HostRunner } from '../../src/services/runner/host/HostRunner';
import { HostError, type HostClient } from '../../src/services/host/connection';
import type { SessionSummary, TranscriptItem } from '../../src/services/runner/types';

type OnEvent = (event: string, data: unknown) => void;
type StreamScript = (onEvent: OnEvent, signal?: AbortSignal) => Promise<void>;

const session = (status: SessionSummary['status'] = 'idle') =>
  ({ id: 's1', projectId: '.', title: 'T', status, createdAt: 1, updatedAt: 2, messageCount: 2 }) as SessionSummary;
const user: TranscriptItem = { kind: 'user', id: 'u1', at: 1, text: 'hi' };
const activity = (status: 'running' | 'done') =>
  ({ kind: 'activity', id: 'a1', at: 1, title: 'Working', status }) as TranscriptItem;
const reply: TranscriptItem = { kind: 'assistant', id: 'r1', at: 2, text: 'pong' };

/** A fake connection to the Orbit host: scripted SSE streams per path, JSON answers per path. */
function fakeHost(streams: Record<string, StreamScript[]>, json: Record<string, () => unknown> = {}) {
  const calls: string[] = [];
  const host = {
    json: vi.fn(async (path: string) => {
      calls.push(`json ${path}`);
      const answer = json[path];
      if (!answer) throw new HostError('Not found', 404);
      return answer();
    }),
    stream: vi.fn(async (path: string, init: { signal?: AbortSignal }, onEvent: OnEvent) => {
      calls.push(`stream ${path}`);
      const next = streams[path]?.shift();
      if (!next) throw new Error(`no scripted stream for ${path}`);
      return next(onEvent, init.signal);
    }),
  };
  return { host: host as unknown as HostClient, calls };
}

const handlers = () => ({ onItem: vi.fn(), onUpdate: vi.fn(), onDone: vi.fn(), onError: vi.fn() });
const settle = () => new Promise((r) => setTimeout(r, 20));
const SEND = '/agent/sessions/s1/send';
const EVENTS = '/agent/sessions/s1/events';

HostRunner.WATCH_BACKOFF_MS = 1;

describe('HostRunner.send', () => {
  it('delivers a normal turn and finishes once', async () => {
    const { host } = fakeHost({
      [SEND]: [
        async (on) => {
          on('item', user);
          on('item', activity('running'));
          on('update', activity('done'));
          on('item', reply);
          on('done', session());
        },
      ],
    });
    const h = handlers();
    new HostRunner(host).send('s1', 'hi', h);
    await settle();
    expect(h.onItem).toHaveBeenCalledTimes(3);
    expect(h.onDone).toHaveBeenCalledTimes(1);
    expect(h.onError).not.toHaveBeenCalled();
  });

  it('re-attaches when the stream drops mid-turn, then catches up on missed items', async () => {
    const { host, calls } = fakeHost(
      {
        // Dropped after the turn started: no 'done'.
        [SEND]: [async (on) => on('item', user)],
        // First re-attach fails (still offline), the second sees the end of the turn.
        [EVENTS]: [
          async () => {
            throw new TypeError('Failed to fetch');
          },
          async (on) => on('done', session()),
        ],
      },
      {
        '/agent/sessions/s1/transcript': () => [user, activity('done'), reply],
        '/agent/sessions/s1': () => session(),
      },
    );
    const h = handlers();
    new HostRunner(host).send('s1', 'hi', h);
    await settle();
    expect(calls.filter((c) => c === `stream ${EVENTS}`)).toHaveLength(2);
    // The reply that arrived while disconnected is delivered (merged by id in the app).
    expect(h.onUpdate).toHaveBeenCalledWith(reply);
    expect(h.onDone).toHaveBeenCalledTimes(1);
    expect(h.onDone).toHaveBeenCalledWith(session());
    expect(h.onError).not.toHaveBeenCalled();
  });

  it('reports an error (no re-attach) when the machine never accepted the turn', async () => {
    const { host, calls } = fakeHost({
      [SEND]: [
        async () => {
          throw new TypeError('Failed to fetch');
        },
      ],
    });
    const h = handlers();
    new HostRunner(host).send('s1', 'hi', h);
    await settle();
    expect(h.onError).toHaveBeenCalledTimes(1);
    expect(calls).not.toContain(`stream ${EVENTS}`);
  });

  it('passes on the host refusing a turn (e.g. already running)', async () => {
    const { host } = fakeHost({
      [SEND]: [async (on) => on('error', { message: 'This session is already running a turn.', status: 409 })],
    });
    const h = handlers();
    new HostRunner(host).send('s1', 'hi', h);
    await settle();
    expect(h.onError).toHaveBeenCalledWith(new Error('This session is already running a turn.'));
    expect(h.onDone).not.toHaveBeenCalled();
  });

  it('Stop that cannot reach the machine ends with an error instead of hanging', async () => {
    let release: () => void = () => {};
    const { host } = fakeHost({
      [SEND]: [
        (on, signal) =>
          new Promise<void>((resolve) => {
            on('item', user);
            release = resolve;
            signal?.addEventListener('abort', () => resolve());
          }),
      ],
    });
    // No JSON answer for /stop: the fake throws, like an unreachable machine.
    const h = handlers();
    const run = new HostRunner(host).send('s1', 'hi', h);
    await settle();
    run.stop();
    await settle();
    release();
    expect(h.onError).toHaveBeenCalledTimes(1);
    expect(h.onDone).not.toHaveBeenCalled();
  });
});

describe('HostRunner.watch', () => {
  it('returns when the turn is already over (idle)', async () => {
    const { host } = fakeHost({ [EVENTS]: [async (on) => on('idle', session())] });
    const h = handlers();
    await new HostRunner(host).watch('s1', h);
    expect(h.onDone).toHaveBeenCalledWith(session());
  });

  it('gives up with a clear message after repeated drops', async () => {
    const drop: StreamScript = async () => {};
    const { host } = fakeHost({ [EVENTS]: Array.from({ length: HostRunner.WATCH_RETRIES + 1 }, () => drop) });
    await expect(new HostRunner(host).watch('s1', handlers())).rejects.toThrow(/keeps working there/);
  });

  it('does not retry an unknown session', async () => {
    const { host, calls } = fakeHost({
      [EVENTS]: [
        async () => {
          throw new HostError('Unknown session.', 404);
        },
      ],
    });
    await expect(new HostRunner(host).watch('s1', handlers())).rejects.toThrow('Unknown session.');
    expect(calls.filter((c) => c === `stream ${EVENTS}`)).toHaveLength(1);
  });

  it('stops quietly when aborted', async () => {
    const ac = new AbortController();
    const { host } = fakeHost({ [EVENTS]: [async () => ac.abort()] });
    await expect(new HostRunner(host).watch('s1', handlers(), ac.signal)).resolves.toBeUndefined();
  });
});
