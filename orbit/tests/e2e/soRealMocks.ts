import type { Page } from '@playwright/test';

/** The AI machine's movie API, mocked in memory (soReal tests). */

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

export type Shot = { id: string; prompt: string; itemId: string | null; status: string; error: string | null };
type Movie = { id: string; title: string; look: string; maker: string; size: string; seconds: number; start: string | null; shots: Shot[]; render: unknown; running: boolean; createdAt: string; updatedAt: string };

export async function mockMovies(page: Page) {
  const items = [
    { id: 'oldvid1', kind: 'video', prompt: 'a red car in the rain', seconds: 5, createdAt: '2026-10-16T09:00:00Z', url: '/_orbit/studio/file/oldvid1?t=tok' },
    { id: 'newvid1', kind: 'video', prompt: 'a woman walks to the car', seconds: 5, createdAt: '2026-10-16T10:00:00Z', url: '/_orbit/studio/file/newvid1?t=tok' },
    { id: 'pic1', kind: 'image', prompt: 'a city at night', createdAt: '2026-10-16T11:00:00Z', url: '/_orbit/studio/file/pic1?t=tok' },
  ];
  const movies = new Map<string, Movie>();
  const calls: { method: string; path: string; body?: unknown }[] = [];
  let n = 0;
  const now = () => new Date(Date.now() + n++).toISOString();
  await page.route('**/fake-ai/_orbit/studio/items', (route) => route.fulfill({ json: { items } }));
  await page.route('**/fake-ai/_orbit/studio/makers', (route) =>
    route.fulfill({ json: { makers: [{ id: 'ltx', kind: 'video', installed: true }, { id: 'h3-max', kind: 'video', installed: false }] } }),
  );
  await page.route('**/fake-ai/_orbit/studio/file/**', (route) => route.fulfill({ status: 200, headers: { 'content-type': 'image/png' }, body: PNG }));
  await page.route('**/fake-ai/_orbit/studio/movies**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^.*\/_orbit\/studio\/movies/, '');
    const body = req.method() === 'POST' || req.method() === 'PUT' ? req.postDataJSON() : undefined;
    calls.push({ method: req.method(), path, body });
    if (path === '' && req.method() === 'GET') return route.fulfill({ json: { movies: [...movies.values()].reverse() } });
    if (path === '' && req.method() === 'POST') {
      const m: Movie = {
        id: `movie${movies.size + 1}`, title: body.title, look: body.look ?? '', maker: body.maker ?? 'ltx', size: body.size ?? 'landscape', seconds: body.seconds ?? 5,
        start: body.start ?? null, shots: body.shots.map((s: Shot) => ({ ...s, itemId: null, status: 'todo', error: null })), render: null, running: false, createdAt: now(), updatedAt: now(),
      };
      movies.set(m.id, m);
      return route.fulfill({ json: m });
    }
    const [, id, action] = /^\/([^/]+)(?:\/(\w+))?$/.exec(path)!;
    const m = movies.get(id)!;
    if (!action && req.method() === 'GET') {
      // Each look makes one more shot, like the machine working through the list.
      if (m.running) {
        const next = m.shots.find((s) => s.status !== 'done')!;
        const item = { id: `shotvid${items.length}`, kind: 'video', prompt: next.prompt, seconds: m.seconds, createdAt: now(), url: `/_orbit/studio/file/shotvid${items.length}?t=tok` };
        items.push(item);
        Object.assign(next, { status: 'done', itemId: item.id });
        m.running = m.shots.some((s) => s.status !== 'done');
      }
      return route.fulfill({ json: m });
    }
    if (!action && req.method() === 'PUT') {
      Object.assign(m, { ...body, shots: body.shots.map((s: Shot) => ({ ...s })), updatedAt: now() });
      return route.fulfill({ json: m });
    }
    if (action === 'run') {
      m.running = true;
      m.shots.find((s) => s.status !== 'done')!.status = 'making';
      return route.fulfill({ json: m });
    }
    if (action === 'render') {
      const item = { id: 'final1', kind: 'video', prompt: m.title, maker: 'soreal', seconds: 10, createdAt: now(), url: '/_orbit/studio/file/final1?t=tok' };
      m.render = { itemId: item.id, at: now() };
      return route.fulfill({ json: { movie: m, item } });
    }
    if (req.method() === 'DELETE') {
      movies.delete(id);
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ status: 404, json: { error: 'nope' } });
  });
  return { calls, movies };
}
