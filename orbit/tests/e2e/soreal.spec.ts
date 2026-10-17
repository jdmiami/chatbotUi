import { expect, test, type Page } from '@playwright/test';
import { expectNoHorizontalOverflow, openOrbit } from './helpers';
import { mockAi, sse } from './aiMocks';

/** soReal on iPhone / iPad viewports, with the AI machine's movie API mocked in memory. */

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

type Shot = { id: string; prompt: string; itemId: string | null; status: string; error: string | null };
type Movie = { id: string; title: string; look: string; maker: string; size: string; seconds: number; start: string | null; shots: Shot[]; render: unknown; running: boolean; createdAt: string; updatedAt: string };

async function mockMovies(page: Page) {
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

async function openSoReal(page: Page) {
  const win = page.locator('.app-window[data-app="soreal"]');
  const icon = page.getByRole('button', { name: /^soReal\./ });
  await expect(win.or(icon).first()).toBeVisible();
  if (!(await win.isVisible())) await icon.click();
  await expect(win.getByRole('heading', { name: 'soReal' })).toBeVisible();
  return win;
}

async function expectTappable(page: Page, min = 44) {
  const boxes = await page.locator('.app-window[data-app="soreal"] button:visible').evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { name: el.getAttribute('aria-label') || el.textContent?.trim() || '?', x: r.x, right: r.right, w: r.width, h: r.height };
    }),
  );
  const vw = page.viewportSize()!.width;
  for (const b of boxes) {
    expect(b.x, `${b.name} starts on screen`).toBeGreaterThanOrEqual(0);
    expect(b.right, `${b.name} ends on screen`).toBeLessThanOrEqual(vw + 1);
    expect(Math.min(b.w, b.h), `${b.name} is big enough to tap`).toBeGreaterThanOrEqual(min);
  }
}

test.describe('soReal', () => {
  test('off: asks to turn the AI machine on', async ({ page }) => {
    await mockAi(page, 'off');
    await mockMovies(page);
    const errors = await openOrbit(page);
    const win = await openSoReal(page);
    await expect(win.getByRole('status').filter({ hasText: 'soReal makes your movies on your AI machine' })).toBeVisible();
    await win.getByRole('button', { name: 'Turn on' }).click();
    await expect(win.getByRole('button', { name: 'New movie' }).first()).toBeEnabled();
    expect(errors).toEqual([]);
  });

  test('a movie: starts from the latest video, chains the shots, plays and exports', async ({ page }) => {
    await mockAi(page, 'on');
    const api = await mockMovies(page);
    const errors = await openOrbit(page);
    const win = await openSoReal(page);
    await win.getByRole('button', { name: 'New movie' }).first().click();
    // A new movie picks up from the newest video in the gallery.
    await expect(win.getByText('The last frame of “a woman walks to the car”')).toBeVisible();
    expect(api.calls.find((c) => c.method === 'POST' && c.path === '')!.body).toMatchObject({ start: 'newvid1' });

    await win.getByRole('textbox', { name: 'Title' }).fill('Night drive');
    await win.getByRole('textbox', { name: 'Look and characters' }).fill('A woman in a red coat, neon city');
    await win.getByRole('textbox', { name: 'What happens in shot 1' }).fill('She gets in the car');
    await win.getByRole('button', { name: 'Add shot' }).click();
    await win.getByRole('textbox', { name: 'What happens in shot 2' }).fill('The car pulls away');
    await expect(win.getByText('picks up from the last frame')).toHaveCount(2);
    await expectNoHorizontalOverflow(page);
    await expectTappable(page);

    await win.getByRole('button', { name: 'Make the movie' }).click();
    const put = api.calls.filter((c) => c.method === 'PUT').pop()!;
    expect(put.body).toMatchObject({ title: 'Night drive', look: 'A woman in a red coat, neon city', start: 'newvid1' });
    expect((put.body as { shots: Shot[] }).shots.map((s) => s.prompt)).toEqual(['She gets in the car', 'The car pulls away']);
    await expect(win.getByRole('button', { name: 'Stop' })).toBeVisible();
    await expect(win.locator('.sr-bar-text')).toHaveText('All shots made', { timeout: 15_000 });
    await expect(win.locator('.sr-badge-done')).toHaveCount(2);

    await win.getByRole('button', { name: 'Watch' }).click();
    const watch = page.getByRole('dialog', { name: 'Night drive' });
    await expect(watch.getByText('Shot 1 of 2')).toBeVisible();
    await watch.getByRole('button', { name: /Close/ }).first().click();

    await win.getByRole('button', { name: 'Export' }).click();
    await expect(page.getByRole('dialog', { name: 'Night drive' }).getByRole('link', { name: 'Save' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('plan with AI writes the shots from an idea', async ({ page }) => {
    await mockAi(page, 'on');
    await mockMovies(page);
    await page.route('**/fake-ai/v1/chat/completions', (route) =>
      route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: sse('["A courier grabs the box.", "She sprints through rain.", "She reaches the door at midnight."]') }),
    );
    const errors = await openOrbit(page);
    const win = await openSoReal(page);
    await win.getByRole('button', { name: 'New movie' }).first().click();
    await win.getByRole('button', { name: 'Plan with AI' }).click();
    const sheet = page.getByRole('dialog', { name: 'Plan with AI' });
    await sheet.getByRole('textbox').fill('A courier races to deliver a box before midnight');
    await sheet.getByRole('button', { name: 'Write the shots' }).click();
    await expect(sheet.getByText('She sprints through rain.')).toBeVisible();
    await sheet.getByRole('button', { name: 'Use these shots' }).click();
    await expect(win.getByRole('textbox', { name: 'What happens in shot 3' })).toHaveValue('She reaches the door at midnight.');
    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });
});
