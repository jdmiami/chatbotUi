import type { Page } from '@playwright/test';

/**
 * The AI machine's movie API, mocked in memory (soReal tests). Each look at a movie that is being
 * made moves it on: the story, lead and storyboard first, then one shot per look, then the cut.
 */

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

type Status = 'todo' | 'making' | 'done' | 'error';
export type Shot = { id: string; prompt: string; itemId: string | null; status: Status; error: string | null; end?: string; says?: string; trimStart?: number; trimEnd?: number; frames?: string[]; redo?: boolean };
type Frame = { id: string; prompt: string; itemId: string | null; status: Status; error: string | null };
export type MockMovie = {
  id: string;
  flow?: 'auto';
  title: string;
  autoTitle: boolean;
  idea: string;
  template: string | null;
  length: number;
  size: string;
  maker: string;
  seconds: number;
  shotSeconds: number;
  look: string;
  start: null;
  opening: string;
  lead: { mode: string; description: string; itemId: string | null; jobId: string | null; status: Status; error: string | null };
  sound: string;
  soundPicked: string | null;
  reviewStoryboard: boolean;
  approved: boolean;
  continuity: 'keyframes';
  story: string | null;
  frames: Frame[];
  shots: Shot[];
  phase: string;
  error: string | null;
  render: { itemId: string; at: string; stale?: boolean } | null;
  running: boolean;
  runningOn: string | null;
  etaSeconds: number;
  createdAt: string;
  updatedAt: string;
};

export async function mockMovies(page: Page) {
  const items: { id: string; kind: string; prompt: string; seconds?: number; createdAt: string; url: string }[] = [
    { id: 'oldvid1', kind: 'video', prompt: 'a red car in the rain', seconds: 5, createdAt: '2026-10-16T09:00:00Z', url: '/_orbit/studio/file/oldvid1?t=tok' },
  ];
  const movies = new Map<string, MockMovie>();
  const calls: { method: string; path: string; body?: Record<string, unknown> }[] = [];
  let n = 0;
  let ids = 0;
  const id = (p: string) => `${p}${String(++ids).padStart(4, '0')}`;
  const now = () => new Date(Date.now() + n++).toISOString();
  const item = (kind: 'image' | 'video', prompt: string) => {
    const it = { id: id(kind === 'image' ? 'pic' : 'vid'), kind, prompt, seconds: kind === 'video' ? 5 : undefined, createdAt: now(), url: '' };
    it.url = `/_orbit/studio/file/${it.id}?t=tok`;
    items.push(it);
    return it.id;
  };
  /** Four minutes a shot, a minute for the rest. */
  const eta = (m: MockMovie) => (m.phase === 'done' ? 0 : 60 * (1 + 4 * (m.shots.length ? m.shots.filter((s) => s.status !== 'done').length : Math.round(m.length / 5))));
  const out = (m: MockMovie) => ({ ...m, etaSeconds: eta(m) });
  const syncFrames = (m: MockMovie) => {
    m.frames = [m.opening || 'The opening', ...m.shots.map((s) => s.end || `${s.prompt} (end)`)].map((prompt) => ({ id: id('frame'), prompt, itemId: null, status: 'todo', error: null }));
    m.shots.forEach((s, i) => (s.frames = [m.frames[i].id, m.frames[i + 1].id]));
  };
  /** The AI writes the story. */
  const plan = (m: MockMovie) => {
    const count = Math.round(m.length / 5);
    m.opening = 'A hill under a blue sky';
    m.shots = Array.from({ length: count }, (_, i) => ({ id: id('shot'), prompt: `Beat ${i + 1}: ${m.idea || 'a surprise'}`, end: `The end of beat ${i + 1}`, itemId: null, status: 'todo', error: null, trimStart: 0, trimEnd: 0 }));
    if (m.lead.mode === 'auto' || (m.lead.mode === 'ai' && !m.lead.description)) m.lead = { ...m.lead, mode: 'ai', description: 'A woman in a yellow raincoat' };
    if (!m.look) m.look = 'Bright, windy, 35 mm film';
    m.soundPicked = m.template === 'ad' ? 'music' : 'shots';
    m.story = 'ai';
    if (m.autoTitle) m.title = 'Kite Day';
    syncFrames(m);
  };
  /** One look at a movie being made moves it on. */
  const advance = (m: MockMovie) => {
    if (!m.running) return;
    if (!m.shots.length) plan(m);
    if (m.lead.mode === 'ai' && !m.lead.itemId) Object.assign(m.lead, { itemId: item('image', 'the lead'), status: 'done' });
    if (m.frames.some((f) => !f.itemId)) {
      for (const f of m.frames) if (!f.itemId) Object.assign(f, { itemId: item('image', f.prompt), status: 'done' });
      if (m.reviewStoryboard && !m.approved) {
        Object.assign(m, { phase: 'review', running: false, runningOn: null });
        return;
      }
      m.phase = 'shots';
      const next = m.shots.find((s) => s.status !== 'done');
      if (next) next.status = 'making';
      return;
    }
    const next = m.shots.find((s) => s.status !== 'done');
    if (next) {
      Object.assign(next, { status: 'done', itemId: item('video', next.prompt) });
      m.phase = 'shots';
      if (m.render) m.render.stale = true;
      const after = m.shots.find((s) => s.status !== 'done');
      if (after) {
        after.status = 'making';
        return;
      }
    }
    m.render = { itemId: item('video', m.title), at: now() };
    Object.assign(m, { phase: 'done', running: false, runningOn: null });
  };

  await page.route('**/fake-ai/_orbit/studio/items', (route) => route.fulfill({ json: { items } }));
  await page.route('**/fake-ai/_orbit/studio/makers', (route) => route.fulfill({ json: { makers: [{ id: 'ltx', kind: 'video', installed: true }] } }));
  await page.route('**/fake-ai/_orbit/studio/file/**', (route) => route.fulfill({ status: 200, headers: { 'content-type': 'image/png' }, body: PNG }));
  await page.route('**/fake-ai/_orbit/studio/movies**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^.*\/_orbit\/studio\/movies/, '');
    const body = req.method() === 'POST' || req.method() === 'PUT' ? (req.postDataJSON() ?? {}) : undefined;
    calls.push({ method: req.method(), path, body });
    if (path === '' && req.method() === 'GET') return route.fulfill({ json: { movies: [...movies.values()].reverse().map(out) } });
    if (path === '/estimate') return route.fulfill({ json: { seconds: (body.length ?? 20) * 30, shots: Math.round((body.length ?? 20) / 5), shotSeconds: 5 } });
    if (path === '' && req.method() === 'POST') {
      const m: MockMovie = {
        id: id('movie'),
        flow: 'auto',
        title: body.title || body.idea || 'Untitled movie',
        autoTitle: !body.title,
        idea: body.idea ?? '',
        template: body.template ?? null,
        length: body.length ?? 20,
        size: body.size ?? 'portrait',
        maker: 'ltx',
        seconds: 5,
        shotSeconds: 5,
        look: body.look ?? '',
        start: null,
        opening: '',
        lead: { mode: 'auto', description: '', itemId: null, jobId: null, status: 'todo', error: null },
        sound: 'auto',
        soundPicked: null,
        reviewStoryboard: Boolean(body.reviewStoryboard),
        approved: false,
        continuity: 'keyframes',
        story: null,
        frames: [],
        shots: [],
        phase: 'draft',
        error: null,
        render: null,
        running: false,
        runningOn: null,
        etaSeconds: 0,
        createdAt: now(),
        updatedAt: now(),
      };
      movies.set(m.id, m);
      return route.fulfill({ json: out(m) });
    }
    const [, mid, action] = /^\/([^/]+)(?:\/(\w+))?$/.exec(path)!;
    const m = movies.get(mid);
    if (!m) return route.fulfill({ status: 404, json: { error: 'No such movie.' } });
    m.updatedAt = now();
    if (!action && req.method() === 'GET') {
      advance(m);
      if (m.lead.status === 'making') Object.assign(m.lead, { status: 'done', itemId: item('image', 'the lead from a photo') });
      return route.fulfill({ json: out(m) });
    }
    if (!action && req.method() === 'PUT') {
      for (const k of ['title', 'idea', 'template', 'length', 'size', 'look', 'sound', 'reviewStoryboard'] as const) if (body[k] !== undefined) (m as Record<string, unknown>)[k] = body[k];
      if (body.lead) m.lead = { ...m.lead, ...body.lead };
      if (body.shots) {
        const old = new Map(m.shots.map((s) => [s.id, s]));
        const made = m.shots.some((s) => s.itemId);
        m.shots = (body.shots as Shot[]).map((s) => {
          const was = old.get(s.id);
          if (!made) return { ...s, id: s.id || id('shot'), itemId: null, status: 'todo' as Status, error: null };
          const redo = s.redo || (was && was.prompt !== s.prompt);
          return { ...was!, prompt: s.prompt, trimStart: s.trimStart ?? 0, trimEnd: s.trimEnd ?? 0, ...(redo ? { itemId: null, status: 'todo' as Status } : {}) };
        });
        if (!made) {
          m.story = 'you';
          syncFrames(m);
        } else if (m.render) m.render.stale = true;
      }
      if (body.frames) {
        for (const f of body.frames as Frame[]) {
          const frame = m.frames.find((x) => x.id === f.id);
          if (frame) Object.assign(frame, { prompt: f.prompt ?? frame.prompt, itemId: null, status: 'todo' });
        }
      }
      if (m.phase === 'done' && (m.render?.stale || m.shots.some((s) => s.status !== 'done'))) m.phase = 'draft';
      return route.fulfill({ json: out(m) });
    }
    if (action === 'plan') {
      plan(m);
      return route.fulfill({ json: out(m) });
    }
    if (action === 'lead') {
      m.lead = { ...m.lead, mode: 'photo', status: 'making', jobId: 'job1', itemId: null };
      return route.fulfill({ json: out(m) });
    }
    if (action === 'run') {
      if (body.approve) m.approved = true;
      Object.assign(m, { running: true, runningOn: new URL(req.url()).pathname.includes('fake-helper') ? 'helper' : 'main', phase: m.shots.length ? 'storyboard' : 'story', error: null });
      return route.fulfill({ json: out(m) });
    }
    if (action === 'stop') {
      Object.assign(m, { running: false, phase: 'stopped' });
      return route.fulfill({ json: out(m) });
    }
    if (action === 'render') {
      m.render = { itemId: item('video', m.title), at: now() };
      if (m.shots.every((s) => s.status === 'done')) m.phase = 'done';
      return route.fulfill({ json: { movie: out(m), item: items[items.length - 1] } });
    }
    if (req.method() === 'DELETE') {
      movies.delete(mid);
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ status: 404, json: { error: 'nope' } });
  });
  return { calls, movies, items };
}
