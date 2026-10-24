import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { expectNoHorizontalOverflow, openApp } from './helpers';
import { mockAi, setShowNsfw } from './aiMocks';

/** The Gallery app: every creation, from cloud storage with the AI machine off, or from the machine. */
const FIX = path.join(path.dirname(new URL(import.meta.url).pathname), 'fixtures', 'gallery');
const SHOTS = process.env.GALLERY_SHOTS || '';
const R2 = 'https://acct.r2.cloudflarestorage.com/orbit-models/gallery';

const stored = (id: string, file: string, extra: Record<string, unknown> = {}) => ({
  id,
  kind: file.endsWith('.webm') ? 'video' : 'image',
  source: 'make',
  prompt: `A picture called ${id}`,
  lab: false,
  createdAt: '2026-10-20T10:00:00Z',
  url: `${R2}/${file}?X-Amz-Signature=abc`,
  downloadUrl: `${R2}/${file}?X-Amz-Signature=abc&response-content-disposition=attachment`,
  bytes: 1000,
  ...extra,
});
const ITEMS = [
  stored('make01', 'sunset.jpg', { prompt: 'A warm sunset over the hills', createdAt: '2026-10-23T10:00:00Z' }),
  stored('lab01', 'clip.webm', { source: 'lab', lab: true, prompt: 'Rooftop glance', title: 'Rooftop glance', caption: 'Golden hour on the roof', hashtags: ['#fyp'], score: 88, seconds: 4, createdAt: '2026-10-23T09:00:00Z' }),
  stored('cloud01', 'forest.jpg', { source: 'cloud', maker: 'cloud:cloudflare', prompt: 'A quiet forest with a full moon', createdAt: '2026-10-22T10:00:00Z' }),
  stored('movie01', 'clip.webm', { source: 'soreal', movie: 'mv1', prompt: 'Neon city chase', seconds: 4, createdAt: '2026-10-21T10:00:00Z' }),
  stored('draw01', 'drawing.jpg', { source: 'livedraw', maker: 'sketch-finish', prompt: 'A red sun over blue hills', createdAt: '2026-10-20T10:00:00Z' }),
  stored('spicy01', 'city.jpg', { prompt: 'A city at night', nsfw: true, createdAt: '2026-10-19T10:00:00Z' }),
];

/** Files from storage (pictures and a short video), and play()/pause() that report like a real video. */
async function serveFiles(page: Page) {
  await page.route(`${R2}/**`, (route) => {
    const name = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop()!);
    const file = path.join(FIX, name);
    if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ status: 200, headers: { 'content-type': name.endsWith('.webm') ? 'video/webm' : 'image/jpeg' }, body: fs.readFileSync(file) });
  });
  await page.addInitScript(() => {
    const w = window as unknown as { plays: number; pauses: number };
    w.plays = 0;
    w.pauses = 0;
    const paused = new WeakMap<HTMLMediaElement, boolean>();
    Object.defineProperty(HTMLMediaElement.prototype, 'paused', { configurable: true, get() { return paused.get(this) ?? true; } });
    HTMLMediaElement.prototype.play = function () {
      w.plays++;
      paused.set(this, false);
      this.dispatchEvent(new Event('play'));
      this.dispatchEvent(new Event('playing'));
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function () {
      w.pauses++;
      if (paused.get(this) === false) {
        paused.set(this, true);
        this.dispatchEvent(new Event('pause'));
      }
    };
  });
}

async function start(page: Page, opts: { machine: 'off' | 'on'; gallery: unknown }) {
  await mockAi(page, opts.machine);
  const posts: Record<string, unknown>[] = [];
  let items = (opts.gallery as { items?: { id: string }[] }).items ?? [];
  await page.route('**/api/gallery', async (route) => {
    const req = route.request();
    if (req.method() === 'POST') {
      const body = req.postDataJSON() as { action: string; id: string };
      posts.push(body);
      if (body.action === 'delete') items = items.filter((i) => i.id !== body.id);
      if (body.action === 'keep') items = items.map((i) => (i.id === body.id ? { ...i, lab: false, source: 'make' } : i));
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ json: { ...(opts.gallery as object), items } });
  });
  // The machine is off: nothing answers there.
  if (opts.machine === 'off') await page.route('**/fake-ai/_orbit/**', (route) => route.abort());
  await serveFiles(page);
  await page.addInitScript(() => {
    if (!localStorage.getItem('orbit:shell:v1'))
      localStorage.setItem('orbit:shell:v1', JSON.stringify({ state: { settings: { orb: false, motion: 'reduce', motionPicked: true, introSeen: true } }, version: 0 }));
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  const win = await openApp(page, 'gallery');
  return { win, posts, errors };
}

const shot = async (page: Page, name: string, project: string) => {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${project}-${name}.png`) });
};

test('Gallery with the AI machine off: everything from cloud storage, tabs, the shared viewer, NSFW, keep and delete', async ({ page }, testInfo) => {
  const { win, posts, errors } = await start(page, { machine: 'off', gallery: { configured: true, items: ITEMS } });
  await expect(win.locator('.mag-title')).toHaveText('Gallery');
  const grid = win.getByRole('list', { name: 'All your creations' });
  // The NSFW one stays hidden until "Show NSFW" is on.
  await expect(grid.getByRole('listitem')).toHaveCount(5);
  await expect(grid.getByRole('button', { name: /city at night/ })).toHaveCount(0);
  await expect(win.getByText(/once storage keys are added/)).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await shot(page, 'grid', testInfo.project.name);

  // Tabs: where it was made, then pictures or videos.
  const sources = win.getByRole('radiogroup', { name: 'Made in' });
  await sources.getByRole('radio', { name: /^Lab/ }).click();
  await expect(win.getByRole('list', { name: 'From Lab' }).getByRole('listitem')).toHaveCount(1);
  await sources.getByRole('radio', { name: /^Everything/ }).click();
  await win.getByRole('group', { name: 'Pictures or videos' }).getByRole('button', { name: 'Videos' }).click();
  await expect(grid.getByRole('listitem')).toHaveCount(2);
  await win.getByRole('group', { name: 'Pictures or videos' }).getByRole('button', { name: 'All' }).click();
  for (const b of await win.locator('.gallery-filters button').all()) {
    const bb = (await b.boundingBox())!;
    expect(Math.min(bb.width, bb.height), `${await b.textContent()} is a 44 px target`).toBeGreaterThanOrEqual(44);
  }

  // A Lab video: the shared viewer plays it at once, with nothing over the picture.
  await grid.getByRole('button', { name: 'Video: Rooftop glance' }).click();
  const viewer = page.getByRole('dialog', { name: 'Lab video' });
  const player = viewer.locator('.ai-player');
  await expect(player).toHaveAttribute('data-playing', '');
  await expect(player).not.toHaveAttribute('data-chrome', /.*/);
  await expect(viewer.locator('video')).not.toHaveAttribute('controls', /.*/);
  await expect(viewer).toContainText('Golden hour on the roof');
  await expect(viewer).toContainText('viral score 88');
  await expect(viewer.getByRole('link', { name: 'Save' })).toHaveAttribute('href', /response-content-disposition=attachment/);
  await expect(viewer.getByText('2 of 5')).toBeVisible();
  await page.waitForTimeout(400);
  await shot(page, 'viewer-video', testInfo.project.name);
  // Tap it: paused, the play button and the bar show. Tap play: both are gone at once.
  await viewer.locator('video').click();
  await expect(player).not.toHaveAttribute('data-playing', /.*/);
  await expect(viewer.getByRole('button', { name: 'Play video' })).toBeVisible();
  await viewer.getByRole('button', { name: 'Play video' }).click();
  await expect(player).toHaveAttribute('data-playing', '');
  await expect(player).not.toHaveAttribute('data-chrome', /.*/);
  await expect(viewer.getByRole('button', { name: 'Play video' })).toHaveCount(0);

  // Swipe to the next one (a picture made in the cloud).
  const stage = viewer.locator('.ai-viewer-stage');
  const sb = (await stage.boundingBox())!;
  await page.mouse.move(sb.x + sb.width * 0.8, sb.y + sb.height / 2);
  await page.mouse.down();
  await page.mouse.move(sb.x + sb.width * 0.5, sb.y + sb.height / 2, { steps: 4 });
  await page.mouse.move(sb.x + sb.width * 0.15, sb.y + sb.height / 2, { steps: 4 });
  await page.mouse.up();
  const pic = page.getByRole('dialog', { name: 'Picture' });
  await expect(pic).toContainText('A quiet forest with a full moon');
  await expect(pic.getByText('3 of 5')).toBeVisible();

  // NSFW with the machine off: saved in cloud storage.
  const sw = pic.getByRole('switch', { name: 'NSFW', exact: true });
  await sw.click();
  await expect.poll(() => posts).toContainEqual({ action: 'nsfw', id: 'cloud01', nsfw: true });
  await sw.click();
  await expect.poll(() => posts).toContainEqual({ action: 'nsfw', id: 'cloud01', nsfw: false });

  // Delete asks first, then it is gone from storage.
  await pic.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('dialog', { name: 'Delete this?' }).getByRole('button', { name: 'Delete' }).click();
  await expect.poll(() => posts).toContainEqual({ action: 'delete', id: 'cloud01' });
  await expect(grid.getByRole('button', { name: /quiet forest/ })).toHaveCount(0);

  // Keep a Lab video in the main gallery, through cloud storage.
  await grid.getByRole('button', { name: 'Video: Rooftop glance' }).click();
  await viewer.getByRole('button', { name: 'Keep in my gallery' }).click();
  await expect.poll(() => posts).toContainEqual({ action: 'keep', id: 'lab01' });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Show NSFW: the NSFW one shows, blurred; held, it shows; let go, it blurs again.
  await setShowNsfw(page, true);
  const tile = grid.getByRole('button', { name: /city at night/ });
  await expect(tile).toBeVisible();
  await tile.click();
  const nsfwViewer = page.getByRole('dialog', { name: 'Picture' });
  const media = nsfwViewer.locator('.ai-viewer-media.censor');
  await expect(media).toBeVisible();
  expect(await media.locator('img').evaluate((el) => getComputedStyle(el).filter)).toContain('blur');
  await page.waitForTimeout(300);
  await shot(page, 'viewer-nsfw-blurred', testInfo.project.name);
  await expectNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
});

test('Gallery with the machine off and no storage keys yet: says so plainly', async ({ page }, testInfo) => {
  const { win, errors } = await start(page, { machine: 'off', gallery: { configured: false, items: [] } });
  await expect(win.getByText('Your gallery shows here with the machine off once storage keys are added.', { exact: false })).toBeVisible();
  await expect(win.getByRole('button', { name: 'Turn it on' })).toBeVisible();
  await expect(win.getByText('Nothing to show yet with the machine off.')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await shot(page, 'machine-off', testInfo.project.name);
  expect(errors).toEqual([]);
});

test('Gallery with no storage keys but the machine on: the machine\'s gallery and the Lab, deleted on the machine', async ({ page }) => {
  await mockAi(page, 'on');
  const studioItems = [
    { id: 'm1', kind: 'image', prompt: 'A warm sunset over the hills', createdAt: '2026-10-23T10:00:00Z', url: `${R2}/sunset.jpg` },
    { id: 'm2', kind: 'video', prompt: 'Neon city chase', maker: 'soreal', movie: 'mv1', seconds: 4, createdAt: '2026-10-22T10:00:00Z', url: `${R2}/clip.webm` },
  ];
  const calls: string[] = [];
  await page.route('**/fake-ai/_orbit/studio/items', (route) => route.fulfill({ json: { items: studioItems } }));
  await page.route('**/fake-ai/_orbit/studio/items/*', (route) => {
    calls.push(`${route.request().method()} ${new URL(route.request().url()).pathname.replace(/.*\/_orbit/, '')}`);
    return route.fulfill({ json: { ok: true } });
  });
  await page.route('**/fake-ai/_orbit/studio/lab', (route) =>
    route.fulfill({ json: { enabled: true, topics: [], queue: [], making: null, records: [{ id: 'l1', title: 'Gym crush energy', prompt: 'x', caption: 'c', hashtags: [], status: 'judged', score: 60, createdAt: '2026-10-21T10:00:00Z', url: `${R2}/clip.webm`, kind: 'video' }] } }),
  );
  await page.route('**/api/gallery', (route) => route.fulfill({ json: { configured: false, items: [] } }));
  await serveFiles(page);
  await page.addInitScript(() => {
    if (!localStorage.getItem('orbit:shell:v1'))
      localStorage.setItem('orbit:shell:v1', JSON.stringify({ state: { settings: { orb: false, motion: 'reduce', motionPicked: true, introSeen: true } }, version: 0 }));
  });
  await page.goto('/');
  const win = await openApp(page, 'gallery');
  const grid = win.getByRole('list', { name: 'All your creations' });
  await expect(grid.getByRole('listitem')).toHaveCount(3);
  await expect(win.getByText(/once storage keys are added/)).toHaveCount(0);
  await win.getByRole('radiogroup', { name: 'Made in' }).getByRole('radio', { name: /^soReal/ }).click();
  await expect(win.getByRole('list', { name: 'From soReal' }).getByRole('listitem')).toHaveCount(1);
  await win.getByRole('radiogroup', { name: 'Made in' }).getByRole('radio', { name: /^Everything/ }).click();
  await grid.getByRole('button', { name: 'Image: A warm sunset over the hills' }).click();
  await page.getByRole('dialog', { name: 'Picture' }).getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('dialog', { name: 'Delete this?' }).getByRole('button', { name: 'Delete' }).click();
  await expect.poll(() => calls).toContain('DELETE /studio/items/m1');
});

test('Make and the Lab open the Gallery', async ({ page }) => {
  await mockAi(page, 'on');
  await page.route('**/fake-ai/_orbit/studio/lab', (route) => route.fulfill({ json: { enabled: true, topics: [], queue: [], making: null, records: [] } }));
  await page.route('**/api/gallery', (route) => route.fulfill({ json: { configured: false, items: [] } }));
  await page.addInitScript(() => {
    if (!localStorage.getItem('orbit:shell:v1'))
      localStorage.setItem('orbit:shell:v1', JSON.stringify({ state: { settings: { orb: false, motion: 'reduce', motionPicked: true, introSeen: true } }, version: 0 }));
  });
  await page.goto('/');
  const lab = await openApp(page, 'lab');
  await lab.getByRole('button', { name: 'All your creations' }).click();
  await expect(page.locator('.app-window[data-app="gallery"]')).toHaveAttribute('data-placement', /^(full|split)/);
});
