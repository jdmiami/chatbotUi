import { expect, test, type Page } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openApp } from './helpers';
import { mockAi } from './aiMocks';

/**
 * The Gallery opens fast: tiles load small thumbnails (never the full pictures or videos), the last list
 * shows at once while the fresh one comes, and the viewer loads the whole file (then the next one's).
 */
const FIX = path.join(path.dirname(new URL(import.meta.url).pathname), 'fixtures', 'gallery');
const R2 = 'https://acct.r2.cloudflarestorage.com/orbit-models/gallery';
const COUNT = 30;
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

/**
 * A full-size picture the size the machine makes (1328x1992 PNG, about 1.7 MB) and its thumbnail made the
 * way the machine makes it (thumbs.js): at most 480 px, WebP. Without ffmpeg: a 2 MB stand-in and a small JPEG.
 */
let FULL: Buffer;
let THUMB: Buffer;
test.beforeAll(() => {
  if (hasFfmpeg) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-fast-'));
    const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
    ff(['-f', 'lavfi', '-i', 'mandelbrot=size=1328x1992:end_pts=1', '-frames:v', '1', path.join(dir, 'full.png')]);
    ff(['-i', path.join(dir, 'full.png'), '-frames:v', '1', '-an', '-vf', "scale='min(480,iw)':'min(480,ih)':force_original_aspect_ratio=decrease", '-c:v', 'libwebp', '-quality', '72', '-compression_level', '4', path.join(dir, 'thumb.webp')]);
    FULL = fs.readFileSync(path.join(dir, 'full.png'));
    THUMB = fs.readFileSync(path.join(dir, 'thumb.webp'));
    fs.rmSync(dir, { recursive: true, force: true });
  } else {
    const jpg = fs.readFileSync(path.join(FIX, 'sunset.jpg'));
    FULL = Buffer.concat([jpg, Buffer.alloc(2 * 1024 * 1024 - jpg.length)]);
    THUMB = fs.readFileSync(path.join(FIX, 'drawing.jpg'));
  }
});

const items = ({ thumbs }: { thumbs: boolean }) =>
  Array.from({ length: COUNT }, (_, i) => {
    const id = `pic${String(i).padStart(3, '0')}`;
    const video = i % 4 === 3;
    const file = video ? `orbit/${id}.mp4` : `orbit/${id}.png`;
    return {
      id,
      kind: video ? 'video' : 'image',
      source: 'make',
      prompt: `Creation number ${i}`,
      width: 1328,
      height: 1992,
      seconds: video ? 5 : undefined,
      nsfw: false,
      lab: false,
      createdAt: new Date(Date.UTC(2026, 9, 23) - i * 60_000).toISOString(),
      url: `${R2}/${file}?X-Amz-Signature=full`,
      downloadUrl: `${R2}/${file}?X-Amz-Signature=full&response-content-disposition=attachment`,
      ...(thumbs ? { thumbUrl: `${R2}/thumbs/${id}.webp?X-Amz-Signature=thumb` } : {}),
      bytes: FULL.length,
    };
  });

/** Storage answers `list` (after `delay` ms; both can change), files are counted as they are asked for. */
async function start(page: Page, first: unknown[]) {
  await mockAi(page, 'off');
  await page.route('**/fake-ai/_orbit/**', (route) => route.abort());
  let delay = 0;
  let list = first;
  const listed: number[] = [];
  const thumbCalls: string[][] = [];
  let makes: (ids: string[]) => { made: { id: string; thumbUrl: string }[]; left: number } = () => ({ made: [], left: 0 });
  await page.route('**/api/gallery', async (route) => {
    // The site making missing thumbnails (machine off): by default it has none to make.
    if (route.request().method() === 'POST') {
      const ids = (route.request().postDataJSON() as { ids: string[] }).ids;
      thumbCalls.push(ids);
      return route.fulfill({ json: makes(ids) });
    }
    const answer = list;
    if (delay) await new Promise((r) => setTimeout(r, delay));
    listed.push(Date.now());
    return route.fulfill({ json: { configured: true, items: answer } });
  });
  const asked: { url: string; bytes: number; at: number }[] = [];
  await page.route(`${R2}/**`, (route) => {
    const u = new URL(route.request().url());
    const thumb = u.pathname.includes('/thumbs/');
    // A video stands in as a file of the same size (its tile only ever asked for part of it, as the browser does).
    const body = thumb ? THUMB : FULL;
    asked.push({ url: u.pathname, bytes: body.length, at: Date.now() });
    return route.fulfill({ status: 200, headers: { 'content-type': thumb ? 'image/webp' : u.pathname.endsWith('.mp4') ? 'video/mp4' : 'image/png' }, body });
  });
  await page.addInitScript(() => {
    if (!localStorage.getItem('orbit:shell:v1'))
      localStorage.setItem('orbit:shell:v1', JSON.stringify({ state: { settings: { orb: false, motion: 'reduce', motionPicked: true, introSeen: true } }, version: 0 }));
  });
  return {
    asked,
    listed,
    thumbCalls,
    siteMakes: (fn: typeof makes) => (makes = fn),
    answer: (next: unknown[], ms = 0) => {
      list = next;
      delay = ms;
    },
  };
}

const TILES = 24;
const inFirst = (url: string) => Number(/pic(\d{3})/.exec(url)?.[1] ?? 999) < TILES;
/** What the first 24 tiles asked for, once they have all been scrolled to and loaded. */
async function firstScreen(page: Page, asked: { url: string; bytes: number }[]) {
  const win = await openApp(page, 'gallery');
  const grid = win.getByRole('list', { name: 'All your creations' });
  await expect(grid.getByRole('listitem')).toHaveCount(COUNT);
  // Scrolled through tile by tile, as a person would.
  for (let i = 0; i < TILES; i += 2) await grid.getByRole('listitem').nth(i).scrollIntoViewIfNeeded();
  await grid.getByRole('listitem').nth(TILES - 1).scrollIntoViewIfNeeded();
  await expect
    .poll(async () =>
      grid.locator('li').evaluateAll(
        (lis, n) =>
          lis.slice(0, n).every((li) => {
            const img = li.querySelector('img');
            return !img || (img.complete && img.naturalWidth > 0);
          }),
        TILES,
      ),
      { timeout: 15_000 },
    )
    .toBe(true);
  await page.waitForTimeout(300);
  const mine = asked.filter((a) => inFirst(a.url));
  return { win, grid, bytes: mine.reduce((n, a) => n + a.bytes, 0), count: mine.length, files: mine.filter((a) => !a.url.includes('/thumbs/')).length };
}

test('gallery tiles load thumbnails, not the full files: the first screen is a fraction of what it was', async ({ page }, testInfo) => {
  // No thumbnails yet (the old way for pictures: the full file; videos wait for their frame, no <video> in the grid).
  const s = await start(page, items({ thumbs: false }));
  await page.goto('/');
  const was = await firstScreen(page, s.asked);
  await expect(was.grid.locator('video')).toHaveCount(0);
  await expect(was.grid.getByRole('button', { name: /^Video: Creation number 3$/ }).locator('.ai-tile-poster')).toContainText('Creation number 3');
  await expect(was.grid.getByRole('button', { name: /^Video: Creation number 3$/ }).locator('.ai-tile-badge')).toContainText('5s');
  // The site is asked to make the missing picture thumbnails, the ones at the top first.
  await expect.poll(() => s.thumbCalls.length).toBeGreaterThan(0);
  expect(s.thumbCalls[0].slice(0, 3)).toEqual(['pic000', 'pic001', 'pic002']);

  // Now with thumbnails (a fresh start: no last list, nothing in the browser's cache that counts).
  s.answer(items({ thumbs: true }));
  await page.evaluate(() => localStorage.removeItem('orbit:gallery:last:v1'));
  s.asked.length = 0;
  await page.goto('/');
  const now = await firstScreen(page, s.asked);
  const grid = now.grid;
  // Pictures and videos alike: an <img> of the thumbnail; no <video> anywhere in the grid.
  await expect(grid.locator('video')).toHaveCount(0);
  const srcs = await grid.locator('img').evaluateAll((imgs) => imgs.map((i) => (i as HTMLImageElement).getAttribute('src') ?? ''));
  expect(srcs.length).toBe(COUNT);
  expect(srcs.every((s) => s.includes('/thumbs/'))).toBe(true);
  expect(now.files, 'no full file is asked for by a tile').toBe(0);
  // Videos keep their play badge.
  await expect(grid.getByRole('button', { name: /^Video: Creation number 3$/ }).locator('.ai-tile-badge')).toBeVisible();
  // The tile knows its shape before it loads, decodes off the main thread, and the first screen comes first.
  const first = grid.locator('img').first();
  await expect(first).toHaveAttribute('width', '1328');
  await expect(first).toHaveAttribute('height', '1992');
  await expect(first).toHaveAttribute('decoding', 'async');
  await expect(first).toHaveAttribute('fetchpriority', 'high');
  await expect(grid.locator('img').nth(COUNT - 1)).toHaveAttribute('loading', 'lazy');

  const mb = (n: number) => `${(n / 1024 / 1024).toFixed(2)} MB`;
  const line = `${testInfo.project.name}: the first ${TILES} tiles asked for ${mb(was.bytes)} in ${was.count} files before, ${mb(now.bytes)} in ${now.count} files now (a full picture ${mb(FULL.length)}, a thumbnail ${(THUMB.length / 1024).toFixed(1)} KB)`;
  testInfo.annotations.push({ type: 'bytes', description: line });
  console.log(line);
  expect(now.count).toBe(TILES);
  expect(now.bytes).toBeLessThan(2 * 1024 * 1024);
  expect(now.bytes).toBeLessThan(was.bytes / 10);
});

test('the gallery opens on the last list at once, then the fresh one replaces it (links renewed)', async ({ page }) => {
  const list = items({ thumbs: true });
  const s = await start(page, list);
  await page.goto('/');
  let win = await openApp(page, 'gallery');
  await expect(win.getByRole('list', { name: 'All your creations' }).getByRole('listitem')).toHaveCount(COUNT);
  // Saved on this device: words, marks and links; nothing of the pictures themselves.
  const saved = await page.evaluate(() => localStorage.getItem('orbit:gallery:last:v1') ?? '');
  expect(saved).toContain('pic000');
  expect(saved.length).toBeLessThan(COUNT * 800);
  expect(saved).not.toMatch(/base64|data:image/);

  // Next time storage takes 4 seconds to answer, and one item is new and not checked for NSFW yet.
  const fresh = list.map((it) => ({ ...it, thumbUrl: it.thumbUrl!.replace('thumb', 'renewed') }));
  const latest = [{ ...list[0], id: 'brandnew', prompt: 'Brand new one', createdAt: '2026-10-24T00:00:00Z', thumbUrl: `${R2}/thumbs/brandnew.webp?X-Amz-Signature=renewed` }, ...fresh];
  s.answer(latest, 4000);
  s.listed.length = 0;
  // A saved item the check had not looked at yet stays hidden while the last list shows.
  await page.evaluate(() => {
    const v = JSON.parse(localStorage.getItem('orbit:gallery:last:v1')!);
    delete v.stored.items[1].nsfw;
    v.stored.items[1].prompt = 'Not checked yet';
    localStorage.setItem('orbit:gallery:last:v1', JSON.stringify(v));
  });
  const opened = Date.now();
  await page.reload();
  win = await openApp(page, 'gallery');
  const grid = win.getByRole('list', { name: 'All your creations' });
  await expect(grid.getByRole('listitem')).toHaveCount(COUNT - 1, { timeout: 3000 });
  expect(s.listed.length, 'shown before storage answered').toBe(0);
  expect(Date.now() - opened).toBeLessThan(4000);
  await expect(grid.getByRole('button', { name: /Not checked yet/ })).toHaveCount(0);
  await expect(win.getByText('Opening your gallery…')).toHaveCount(0);
  // Then the fresh list: the new one in, the checked one back, every link renewed.
  await expect(grid.getByRole('listitem')).toHaveCount(COUNT + 1, { timeout: 10_000 });
  await expect(grid.getByRole('button', { name: /Brand new one/ })).toHaveCount(1);
  const srcs = await grid.locator('img').evaluateAll((imgs) => imgs.map((i) => (i as HTMLImageElement).getAttribute('src') ?? ''));
  expect(srcs.every((src) => src.includes('renewed'))).toBe(true);
});

test('the viewer loads the whole file, then the next and previous ones', async ({ page }) => {
  const { asked } = await start(page, items({ thumbs: true }));
  await page.goto('/');
  const win = await openApp(page, 'gallery');
  const grid = win.getByRole('list', { name: 'All your creations' });
  await expect(grid.getByRole('listitem')).toHaveCount(COUNT);
  await grid.getByRole('button', { name: /^Image: Creation number 1$/ }).click();
  const viewer = page.getByRole('dialog');
  const img = viewer.locator('.ai-viewer-media img');
  await expect(img).toHaveAttribute('src', /orbit\/pic001\.png\?X-Amz-Signature=full/);
  await expect.poll(() => img.evaluate((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0)).toBe(true);
  // Once it has loaded: the picture after it whole, and the video before it its thumbnail (its poster).
  await expect.poll(() => asked.some((a) => a.url.endsWith('/orbit/pic002.png'))).toBe(true);
  await expect.poll(() => asked.some((a) => a.url.endsWith('/thumbs/pic000.webp'))).toBe(true);
  // A video in the viewer shows its thumbnail while it loads.
  await viewer.getByRole('button', { name: 'Next' }).click();
  await viewer.getByRole('button', { name: 'Next' }).click();
  const video = viewer.locator('.ai-viewer-media video');
  await expect(video).toHaveAttribute('src', /orbit\/pic003\.mp4/);
  await expect(video).toHaveAttribute('poster', /thumbs\/pic003\.webp/);
});

test('with the machine off, the site makes the missing picture thumbnails and each tile switches to its own', async ({ page }) => {
  const s = await start(page, items({ thumbs: false }));
  // Eight a call, the ones asked for first; videos are not made here.
  s.siteMakes((ids) => {
    const pics = ids.filter((id) => Number(id.slice(3)) % 4 !== 3).slice(0, 8);
    return { made: pics.map((id) => ({ id, thumbUrl: `${R2}/thumbs/${id}.webp?X-Amz-Signature=site` })), left: 0 };
  });
  await page.goto('/');
  const win = await openApp(page, 'gallery');
  const grid = win.getByRole('list', { name: 'All your creations' });
  const tile = (n: number) => grid.getByRole('button', { name: new RegExp(`^Image: Creation number ${n}$`) }).locator('img');
  await expect(tile(0)).toHaveAttribute('src', /thumbs\/pic000\.webp\?X-Amz-Signature=site/);
  await expect(tile(2)).toHaveAttribute('src', /thumbs\/pic002\.webp/);
  // A video still waits for the machine: its placeholder, never a <video>.
  await expect(grid.locator('video')).toHaveCount(0);
  await expect(grid.getByRole('button', { name: /^Video: Creation number 3$/ }).locator('.ai-tile-poster')).toBeVisible();
});
