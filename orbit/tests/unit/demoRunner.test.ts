import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DemoRunner } from '../../src/services/runner/demo/DemoRunner';
import {
  DEMO_MODELS_NOTE,
  DEMO_RUNNER_KEY,
  STOP_NOTICE,
  WORKING_TITLE,
  buildSeed,
  cannedReply,
  replyKind,
} from '../../src/services/runner/demo/fixtures';
import { AGY_CAPABILITIES } from '../../src/services/runner/agyCapabilities';
import type { SendHandlers, SessionSummary, TranscriptItem } from '../../src/services/runner/types';

/** In-memory Storage so tests never touch jsdom's shared localStorage. */
class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  clear() {
    this.data.clear();
  }
  getItem(key: string) {
    return this.data.has(key) ? this.data.get(key)! : null;
  }
  key(i: number) {
    return [...this.data.keys()][i] ?? null;
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  setItem(key: string, value: string) {
    this.data.set(key, String(value));
  }
}

/** Records everything a turn reports. */
function recorder() {
  const items: TranscriptItem[] = [];
  const updates: TranscriptItem[] = [];
  const done: SessionSummary[] = [];
  const errors: Error[] = [];
  const handlers: SendHandlers = {
    onItem: (i) => items.push(i),
    onUpdate: (i) => updates.push(i),
    onDone: (s) => done.push(s),
    onError: (e) => errors.push(e),
  };
  return { items, updates, done, errors, handlers };
}

let storage: MemoryStorage;

beforeEach(() => {
  vi.useFakeTimers();
  storage = new MemoryStorage();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('DemoRunner basics', () => {
  it('reports the real CLI capabilities and an honest label', () => {
    const r = new DemoRunner({ storage });
    expect(r.capabilities).toBe(AGY_CAPABILITIES);
    expect(r.kind).toBe('demo');
    expect(r.label).toBe('Demo runner — simulated replies, Antigravity CLI not called');
  });

  it('seeds three projects and 3–5 simulated sessions with transcripts', async () => {
    const r = new DemoRunner({ storage });
    const projects = await r.listProjects();
    expect(projects.map((p) => p.name)).toEqual(['orbit-demo', 'api-service', 'dotfiles']);
    const all = (await Promise.all(projects.map((p) => r.listSessions(p.id)))).flat();
    expect(all.length).toBeGreaterThanOrEqual(3);
    expect(all.length).toBeLessThanOrEqual(5);
    expect(all.every((s) => s.simulated)).toBe(true);
    const kinds = new Set<string>();
    for (const s of all) for (const i of await r.getTranscript(s.id)) kinds.add(i.kind);
    expect([...kinds].sort()).toEqual(['activity', 'assistant', 'notice', 'user']);
    // Seeded activity is finished, never "running".
    for (const s of all) {
      for (const i of await r.getTranscript(s.id)) if (i.kind === 'activity') expect(i.status).not.toBe('running');
    }
    expect(await r.listSessions('dotfiles')).toEqual([]);
  });

  it('lists sessions newest first', async () => {
    const r = new DemoRunner({ storage });
    const list = await r.listSessions('orbit-demo');
    const times = list.map((s) => s.updatedAt);
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it('does not throw when storage is unavailable', async () => {
    const broken = {
      getItem() {
        throw new Error('SecurityError');
      },
      setItem() {
        throw new Error('QuotaExceededError');
      },
    } as unknown as Storage;
    const r = new DemoRunner({ storage: broken });
    expect((await r.listProjects()).length).toBe(3);
    const s = await r.createSession('dotfiles', { title: 'Works in memory' });
    expect((await r.listSessions('dotfiles')).map((x) => x.id)).toEqual([s.id]);
    expect(() => new DemoRunner({ storage: null })).not.toThrow();
  });

  it('falls back to the seed when stored data is corrupted', async () => {
    storage.setItem(DEMO_RUNNER_KEY, '{not json');
    const r = new DemoRunner({ storage });
    expect((await r.listProjects()).length).toBe(3);
  });

  it('lists sample models labelled as a sample', async () => {
    const r = new DemoRunner({ storage });
    const models = await r.listModels();
    expect(models.length).toBeGreaterThan(0);
    expect(r.modelsNote).toBe(DEMO_MODELS_NOTE);
    expect(DEMO_MODELS_NOTE).toBe('Sample list; the real list comes from `agy models`');
  });
});

describe('DemoRunner sessions', () => {
  it('creates a session with defaults and notifies subscribers', async () => {
    const r = new DemoRunner({ storage });
    const listener = vi.fn();
    r.subscribe(listener);
    const s = await r.createSession('dotfiles');
    expect(s).toMatchObject({
      projectId: 'dotfiles',
      title: 'New session',
      status: 'idle',
      mode: 'default',
      messageCount: 0,
      simulated: true,
    });
    expect(s.conversationId).toBeUndefined();
    expect(await r.getTranscript(s.id)).toEqual([]);
    expect(listener).toHaveBeenCalled();
    await expect(r.createSession('nope')).rejects.toThrow(/Unknown project/);
  });

  it('creates with title, mode and model', async () => {
    const r = new DemoRunner({ storage });
    const s = await r.createSession('orbit-demo', { title: '  Refactor utils  ', mode: 'plan', model: 'sample-fast' });
    expect(s).toMatchObject({ title: 'Refactor utils', mode: 'plan', model: 'sample-fast' });
  });

  it('renames, changes mode/model (empty model = default) and deletes', async () => {
    const r = new DemoRunner({ storage });
    const s = await r.createSession('orbit-demo', { model: 'sample-pro' });
    const renamed = await r.updateSession(s.id, { title: 'Renamed' });
    expect(renamed.title).toBe('Renamed');
    expect((await r.updateSession(s.id, { title: '   ' })).title).toBe('Renamed');
    expect((await r.updateSession(s.id, { mode: 'accept-edits' })).mode).toBe('accept-edits');
    expect((await r.updateSession(s.id, { model: '' })).model).toBeUndefined();
    await expect(r.updateSession(s.id, { mode: 'yolo' as never })).rejects.toThrow(/Unknown mode/);

    const listener = vi.fn();
    r.subscribe(listener);
    await r.deleteSession(s.id);
    expect(listener).toHaveBeenCalled();
    expect(await r.getSession(s.id)).toBeUndefined();
    expect((await r.listSessions('orbit-demo')).some((x) => x.id === s.id)).toBe(false);
    await expect(r.deleteSession(s.id)).rejects.toThrow(/Unknown session/);
    await expect(r.updateSession(s.id, { title: 'x' })).rejects.toThrow(/Unknown session/);
  });

  it('unsubscribe stops notifications', async () => {
    const r = new DemoRunner({ storage });
    const listener = vi.fn();
    const off = r.subscribe(listener);
    off();
    await r.createSession('dotfiles');
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('DemoRunner turns', () => {
  it('send → running, user item + working activity, then the whole reply and a conversation id', async () => {
    const r = new DemoRunner({ storage });
    const s = await r.createSession('orbit-demo');
    const rec = recorder();
    r.send(s.id, 'Explain the project', rec.handlers);

    expect(rec.items.map((i) => i.kind)).toEqual(['user', 'activity']);
    expect(rec.items[0]).toMatchObject({ kind: 'user', text: 'Explain the project' });
    expect(rec.items[1]).toMatchObject({ kind: 'activity', title: WORKING_TITLE, status: 'running' });
    expect((await r.getSession(s.id))!.status).toBe('running');

    await vi.advanceTimersByTimeAsync(1000);
    expect(rec.done).toHaveLength(0); // not before ~1.2 s

    await vi.advanceTimersByTimeAsync(1100);
    expect(rec.errors).toEqual([]);
    expect(rec.done).toHaveLength(1);
    const reply = rec.items.find((i) => i.kind === 'assistant');
    expect(reply).toBeTruthy();
    expect(reply && reply.kind === 'assistant' && reply.text).toMatch(/[Ss]imulated/);
    // streamOutput is 'unverified' → the reply arrives whole, never as streaming updates.
    expect(reply && reply.kind === 'assistant' && reply.streaming).toBeFalsy();
    expect(rec.updates.filter((u) => u.kind === 'assistant')).toEqual([]);
    expect(rec.updates.find((u) => u.kind === 'activity')).toMatchObject({ status: 'done' });

    const after = rec.done[0];
    expect(after.status).toBe('idle');
    expect(after.conversationId).toMatch(/^demo-/);
    expect(after.messageCount).toBe(2);
    expect(after.updatedAt).toBeGreaterThanOrEqual(s.updatedAt);

    const transcript = await r.getTranscript(s.id);
    expect(transcript.map((i) => i.kind)).toEqual(['user', 'activity', 'assistant']);
    expect(transcript[1]).toMatchObject({ status: 'done' });
  });

  it('keeps the conversation id for follow-ups and mentions --conversation in the activity detail', async () => {
    const r = new DemoRunner({ storage });
    const s = await r.createSession('orbit-demo');
    const first = recorder();
    r.send(s.id, 'hello', first.handlers);
    await vi.advanceTimersByTimeAsync(2100);
    const convId = first.done[0].conversationId;
    const second = recorder();
    r.send(s.id, 'and again', second.handlers);
    const act = second.items.find((i) => i.kind === 'activity');
    expect(act && act.kind === 'activity' && act.detail).toContain(`--conversation ${convId}`);
    await vi.advanceTimersByTimeAsync(2100);
    expect(second.done[0].conversationId).toBe(convId);
    expect(second.done[0].messageCount).toBe(4);
  });

  it('stop cancels the pending reply with the stop notice and status "stopped"', async () => {
    const r = new DemoRunner({ storage });
    const s = await r.createSession('orbit-demo');
    const rec = recorder();
    const handle = r.send(s.id, 'Plan a refactor', rec.handlers);
    await vi.advanceTimersByTimeAsync(500);
    handle.stop();

    expect(rec.done).toHaveLength(1);
    expect(rec.done[0].status).toBe('stopped');
    expect(rec.done[0].conversationId).toBeUndefined();
    const notice = rec.items.find((i) => i.kind === 'notice');
    expect(notice).toMatchObject({ kind: 'notice', text: STOP_NOTICE });
    expect(STOP_NOTICE).toBe('Stopped. In the real app this ends the agy process (the turn is cancelled, not paused).');

    await vi.advanceTimersByTimeAsync(5000);
    expect(rec.items.some((i) => i.kind === 'assistant')).toBe(false); // the reply never arrives
    expect(rec.done).toHaveLength(1);
    expect((await r.getSession(s.id))!.status).toBe('stopped');

    // A stopped session accepts the next message.
    const next = recorder();
    r.send(s.id, 'try again', next.handlers);
    expect(next.errors).toEqual([]);
    await vi.advanceTimersByTimeAsync(2100);
    expect(next.done[0].status).toBe('idle');
  });

  it('rejects a concurrent send on a running session via onError', async () => {
    const r = new DemoRunner({ storage });
    const s = await r.createSession('orbit-demo');
    const first = recorder();
    r.send(s.id, 'one', first.handlers);
    const second = recorder();
    r.send(s.id, 'two', second.handlers);
    expect(second.errors).toHaveLength(1);
    expect(second.errors[0].message).toMatch(/already running/);
    expect(second.items).toEqual([]);
    await vi.advanceTimersByTimeAsync(2100);
    expect(first.done).toHaveLength(1);
    expect((await r.getTranscript(s.id)).filter((i) => i.kind === 'user')).toHaveLength(1);
  });

  it('rejects empty messages and unknown sessions via onError', () => {
    const r = new DemoRunner({ storage });
    const a = recorder();
    r.send('missing', 'hi', a.handlers);
    expect(a.errors[0].message).toMatch(/Unknown session/);
    const b = recorder();
    r.send('demo-ses-layout', '   ', b.handlers);
    expect(b.errors[0].message).toMatch(/empty/);
  });

  it('streams token-by-token only when the capability says streaming is supported', async () => {
    const r = new DemoRunner({
      storage,
      capabilities: { ...AGY_CAPABILITIES, streamOutput: { status: 'supported', note: 'test' } },
    });
    const s = await r.createSession('orbit-demo');
    const rec = recorder();
    r.send(s.id, 'Explain the project', rec.handlers);
    await vi.advanceTimersByTimeAsync(5000);
    expect(rec.errors).toEqual([]);
    const streamed = rec.updates.filter((u) => u.kind === 'assistant');
    expect(streamed.length).toBeGreaterThan(3);
    const last = streamed[streamed.length - 1];
    expect(last.kind === 'assistant' && last.streaming).toBe(false);
    expect(last.kind === 'assistant' && last.text).toBe(cannedReply('Explain the project'));
    expect(rec.done[0].status).toBe('idle');
  });

  it('deleting a running session cancels its reply', async () => {
    const r = new DemoRunner({ storage });
    const s = await r.createSession('orbit-demo');
    const rec = recorder();
    r.send(s.id, 'hi', rec.handlers);
    await r.deleteSession(s.id);
    await vi.advanceTimersByTimeAsync(5000);
    expect(rec.items.some((i) => i.kind === 'assistant')).toBe(false);
  });
});

describe('DemoRunner persistence', () => {
  it('persists projects, sessions and transcripts across instances', async () => {
    const a = new DemoRunner({ storage });
    const s = await a.createSession('dotfiles', { title: 'Persist me' });
    const rec = recorder();
    a.send(s.id, 'test the dotfiles', rec.handlers);
    await vi.advanceTimersByTimeAsync(2100);
    expect(storage.getItem(DEMO_RUNNER_KEY)).toBeTruthy();

    const b = new DemoRunner({ storage });
    const again = await b.getSession(s.id);
    expect(again).toMatchObject({ title: 'Persist me', status: 'idle', messageCount: 2 });
    expect(again!.conversationId).toBe(rec.done[0].conversationId);
    expect((await b.getTranscript(s.id)).map((i) => i.kind)).toEqual(['user', 'activity', 'assistant']);
  });

  it('a turn interrupted by a reload is shown as stopped, not running forever', async () => {
    const a = new DemoRunner({ storage });
    const s = await a.createSession('dotfiles');
    a.send(s.id, 'hello', recorder().handlers);
    // "Reload": a new instance reads storage while the old turn's timer never fires.
    const b = new DemoRunner({ storage });
    const again = await b.getSession(s.id);
    expect(again!.status).toBe('stopped');
    const t = await b.getTranscript(s.id);
    expect(t.some((i) => i.kind === 'activity' && i.status === 'running')).toBe(false);
    expect(t[t.length - 1].kind).toBe('notice');
  });

  it('reset() restores the seed and other instances pick it up', async () => {
    const app = new DemoRunner({ storage });
    const listener = vi.fn();
    app.subscribe(listener);
    const s = await app.createSession('dotfiles', { title: 'Temporary' });
    await app.deleteSession('demo-ses-layout');

    // Settings → Reset demo data uses its own instance.
    new DemoRunner({ storage }).reset();
    expect(listener).toHaveBeenCalled();
    expect(await app.getSession(s.id)).toBeUndefined();
    expect(await app.getSession('demo-ses-layout')).toBeTruthy();

    const seed = buildSeed(Date.now());
    const fresh = new DemoRunner({ storage });
    const all = (await Promise.all(seed.projects.map((p) => fresh.listSessions(p.id)))).flat();
    expect(all.map((x) => x.id).sort()).toEqual(seed.sessions.map((x) => x.id).sort());
  });

  it('reset() ends a pending turn with an error instead of leaving it hanging', async () => {
    const r = new DemoRunner({ storage });
    const s = await r.createSession('orbit-demo');
    const rec = recorder();
    r.send(s.id, 'hi', rec.handlers);
    r.reset();
    expect(rec.errors).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(rec.done).toHaveLength(0);
  });
});

describe('canned replies', () => {
  it('pick a reply by keyword', () => {
    expect(replyKind('What does src/app.py do?')).toBe('file');
    expect(replyKind('look at config/settings.json')).toBe('file');
    expect(replyKind('The tests are failing')).toBe('test');
    expect(replyKind('Plan a /health endpoint')).toBe('plan');
    expect(replyKind('Explain the auth flow')).toBe('explain');
    expect(replyKind('hello there')).toBe('default');
  });

  it('every reply says it is simulated and file replies name the file', () => {
    for (const t of ['src/utils.ts please', 'run the tests', 'make a plan', 'explain it', 'hi']) {
      expect(cannedReply(t)).toMatch(/[Ss]imulated|[Ss]ample/);
    }
    expect(cannedReply('open src/utils.ts')).toContain('`src/utils.ts`');
    expect(cannedReply('open src/utils.ts')).toContain('```ts');
  });
});
