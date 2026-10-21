import { expect, test, type Locator, type Page } from '@playwright/test';
import { expectNoHorizontalOverflow } from './helpers';
import { mockAi } from './aiMocks';

/**
 * Live draw in Make (Orbit 0.5): the Pencil draws (synthetic pen pointer events with pressure and
 * tilt), fingers don't while a Pencil is in use, two fingers tap to undo, the drawing streams to the
 * AI machine over a (mocked) WebSocket or, when that can't open, one POST at a time, and Finish
 * starts a Sketch finish job. Chromium with emulated devices: Safari's own Pencil behaviour is not
 * tested here.
 */

const JPEG_B64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
const READY = { installed: true, worker: 'ready', loading: null, error: null, lastMs: 80, paused: null };

async function openMake(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    if (!localStorage.getItem('orbit:shell:v1'))
      localStorage.setItem('orbit:shell:v1', JSON.stringify({ state: { settings: { orb: false, motion: 'reduce', motionPicked: true, skin: 'o5', introSeen: true } }, version: 0 }));
  });
  await page.goto('/');
  await page.getByRole('button', { name: /^Index/ }).click();
  await page.getByRole('dialog', { name: 'Index' }).locator('.o5-index-list').getByRole('button', { name: /^\d*\s*Make/ }).click();
  const win = page.locator('.app-window[data-app="make"]');
  await win.getByRole('radio', { name: /Live draw/ }).click();
  return { win, errors };
}

async function mockStudio(page: Page, { live = true, finish = true } = {}) {
  await mockAi(page, 'on');
  const ready = { ready: true, downloaded: true, percent: 100 };
  await page.route('**/fake-ai/_orbit/studio', (r) => r.fulfill({ json: { setup: 'running', running: true, image: ready, video: ready, downloading: null, downloadError: null, jobs: [] } }));
  await page.route('**/fake-ai/_orbit/studio/items', (r) => r.fulfill({ json: { items: [] } }));
  await page.route('**/fake-ai/_orbit/studio/makers', (r) =>
    r.fulfill({
      json: {
        makers: [
          { id: 'qwen', kind: 'image', name: 'Qwen Uncensored', installed: true, builtIn: true, wanted: true, percent: 100 },
          { id: 'live-draw', kind: 'live', name: 'Live draw (pix2pix-turbo)', installed: live, wanted: live, percent: live ? 100 : 0, size: 3.1e9 },
          { id: 'sketch-finish', kind: 'sketch', name: 'Sketch finish (Z-Image)', installed: finish, wanted: finish, percent: finish ? 100 : 0, size: 27.4e9 },
        ],
      },
    }),
  );
  const jobs: Record<string, unknown>[] = [];
  await page.route('**/fake-ai/_orbit/studio/jobs', (r) => {
    jobs.push(r.request().postDataJSON());
    return r.fulfill({ json: { id: 'j1', kind: 'image', maker: 'sketch-finish', prompt: 'a cat', status: 'queued', progress: 0, error: null, createdAt: '', item: null, position: 0, etaSeconds: 20, notes: [] } });
  });
  await page.route('**/fake-ai/_orbit/studio/jobs/j1', (r) => r.fulfill({ json: { id: 'j1', kind: 'image', maker: 'sketch-finish', prompt: 'a cat', status: 'running', progress: 40, error: null, createdAt: '', item: null, position: 0, etaSeconds: 10, notes: [] } }));
  const posts: Record<string, unknown>[] = [];
  await page.route('**/fake-ai/_orbit/live/draw**', (r) => {
    const req = r.request();
    if (req.method() === 'POST' && req.url().endsWith('/live/draw')) {
      posts.push(req.postDataJSON());
      return r.fulfill({ status: 200, headers: { 'content-type': 'image/jpeg', 'x-live-ms': '95' }, body: Buffer.from(JPEG_B64, 'base64') });
    }
    return r.fulfill({ json: READY });
  });
  return { jobs, posts };
}

/** Frames the mocked AI machine got over the WebSocket (answered with a JPEG each). */
async function mockSocket(page: Page, { refuse = false } = {}) {
  const frames: Record<string, unknown>[] = [];
  const urls: string[] = [];
  await page.routeWebSocket(/\/_orbit\/live\/draw$/, (ws) => {
    urls.push(ws.url());
    if (refuse) {
      ws.close({ code: 1011, reason: 'no' });
      return;
    }
    ws.onMessage((m) => {
      const msg = JSON.parse(String(m));
      if (msg.type !== 'frame') return;
      frames.push(msg);
      ws.send(JSON.stringify({ type: 'frame', id: msg.id, ms: 85, image: `data:image/jpeg;base64,${JPEG_B64}` }));
    });
  });
  return { frames, urls };
}

type P = { x: number; y: number; pressure?: number; tiltX?: number; tiltY?: number };
/** A stroke made of real PointerEvents, as a Pencil (or finger) sends them. */
async function stroke(canvas: Locator, pts: P[], { pointerType = 'pen', pointerId = 7 } = {}) {
  await canvas.evaluate(
    (el, { pts, pointerType, pointerId }) => {
      const r = el.getBoundingClientRect();
      const fire = (type: string, p: P) =>
        el.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            pointerId,
            pointerType,
            isPrimary: pointerId === 7 || pointerId === 20,
            pressure: p.pressure ?? 0.5,
            tiltX: p.tiltX ?? 0,
            tiltY: p.tiltY ?? 0,
            clientX: r.left + p.x * r.width,
            clientY: r.top + p.y * r.height,
            buttons: type === 'pointerup' ? 0 : 1,
          }),
        );
      fire('pointerdown', pts[0]);
      for (const p of pts.slice(1)) fire('pointermove', p);
      fire('pointerup', pts[pts.length - 1]);
    },
    { pts, pointerType, pointerId },
  );
}
const line = (y: number, pressure: number, tiltX = 0): P[] => Array.from({ length: 12 }, (_, i) => ({ x: 0.15 + i * 0.06, y, pressure, tiltX }));

async function inkAt(canvas: Locator, x: number, y: number) {
  return canvas.evaluate(
    (el: HTMLCanvasElement, { x, y }) => {
      const d = el.getContext('2d')!.getImageData(Math.round(x * el.width), Math.round(y * el.height), 1, 1).data;
      return 255 * 3 - (d[0] + d[1] + d[2]);
    },
    { x, y },
  );
}

async function expectTappable(win: Locator) {
  const boxes = await win.locator('.ld button:visible, .ld input:visible').evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { name: el.getAttribute('aria-label') || el.textContent?.trim() || el.getAttribute('type') || '?', w: r.width, h: r.height };
    }),
  );
  for (const b of boxes) expect(Math.min(b.w, b.h), `${b.name} is big enough to tap`).toBeGreaterThanOrEqual(44);
}

test.describe('Live draw', () => {
  test('Pencil strokes with pressure draw, stream to the machine and come back as a live picture; palms and fingers don’t draw', async ({ page }, testInfo) => {
    await mockStudio(page);
    const sock = await mockSocket(page);
    const { win, errors } = await openMake(page);
    await expect(win.getByRole('heading', { name: 'Draw it' })).toBeAttached();
    const canvas = win.getByRole('img', { name: 'Your drawing', exact: true });
    await expect(canvas).toBeVisible();
    // Only the canvas takes over touches.
    expect(await canvas.evaluate((el) => getComputedStyle(el).touchAction)).toBe('none');
    expect(await win.locator('.ld-tools').evaluate((el) => getComputedStyle(el).touchAction)).not.toBe('none');

    // A light line and a hard one: the hard one is darker.
    await stroke(canvas, line(0.3, 0.15));
    await stroke(canvas, line(0.6, 1));
    await expect(canvas).toHaveAttribute('data-strokes', '2');
    expect(await inkAt(canvas, 0.45, 0.6)).toBeGreaterThan(await inkAt(canvas, 0.45, 0.3));
    // A tilted Pencil lays down a wider line.
    await stroke(canvas, line(0.85, 0.6, 70));
    await expect(canvas).toHaveAttribute('data-strokes', '3');

    // The drawing went to the machine as a 512 × 512 PNG over the WebSocket, and the picture came back.
    await expect.poll(() => sock.frames.length).toBeGreaterThan(0);
    const f = sock.frames.at(-1)!;
    expect(String(f.image)).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(Buffer.from(String(f.image), 'base64').subarray(1, 4).toString()).toBe('PNG');
    expect(f.follow).toBe(0.6);
    expect(sock.urls[0]).toMatch(/^ws:\/\/localhost:\d+\/fake-ai\/_orbit\/live\/draw$/);
    await expect(win.getByRole('img', { name: 'Live picture of your drawing' })).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
    await expect(win.locator('.ld-status')).toContainText('85 ms');

    // A Pencil is in use: a finger (or palm) on the canvas draws nothing.
    await expect(win.getByText('Pencil mode: your hand can rest on the screen.')).toBeVisible();
    await stroke(canvas, line(0.45, 0.5), { pointerType: 'touch', pointerId: 20 });
    await expect(canvas).toHaveAttribute('data-strokes', '3');

    // Words and the slider are sent with the next drawing.
    await win.getByRole('textbox', { name: 'What is it?' }).fill('a cat on a windowsill');
    await expect.poll(() => sock.frames.at(-1)?.prompt).toBe('a cat on a windowsill');

    await expectNoHorizontalOverflow(page);
    await expectTappable(win);
    await win.locator('.ld').scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('live-draw.png') });

    // Side by side on an iPad held sideways, one above the other everywhere else.
    const a = (await win.locator('.ld-paper').boundingBox())!;
    const b = (await win.locator('.ld-preview').boundingBox())!;
    if (testInfo.project.name === 'ipad-landscape') {
      expect(b.x).toBeGreaterThan(a.x + a.width - 1);
      expect(Math.abs(b.y - a.y)).toBeLessThan(4);
    } else {
      expect(b.y).toBeGreaterThan(a.y + a.height - 1);
    }
    expect(errors).toEqual([]);
  });

  test('undo, redo, clear, and a two-finger tap to undo', async ({ page }) => {
    await mockStudio(page);
    await mockSocket(page);
    const { win, errors } = await openMake(page);
    const canvas = win.getByRole('img', { name: 'Your drawing', exact: true });
    // Fingers draw while no Pencil has been used.
    await stroke(canvas, line(0.3, 0.5), { pointerType: 'touch', pointerId: 20 });
    await stroke(canvas, line(0.6, 0.5), { pointerType: 'touch', pointerId: 21 });
    await expect(canvas).toHaveAttribute('data-strokes', '2');
    await win.getByRole('button', { name: 'Undo' }).click();
    await expect(canvas).toHaveAttribute('data-strokes', '1');
    await win.getByRole('button', { name: 'Redo' }).click();
    await expect(canvas).toHaveAttribute('data-strokes', '2');
    // Two fingers tapping together: Undo (and no line from either finger).
    await canvas.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const fire = (type: string, id: number, x: number) =>
        el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch', clientX: r.left + x * r.width, clientY: r.top + r.height / 2, buttons: type === 'pointerup' ? 0 : 1 }));
      fire('pointerdown', 31, 0.4);
      fire('pointerdown', 32, 0.6);
      fire('pointerup', 31, 0.4);
      fire('pointerup', 32, 0.6);
    });
    await expect(canvas).toHaveAttribute('data-strokes', '1');
    await win.getByRole('button', { name: 'Clear' }).click();
    await expect(canvas).toHaveAttribute('data-strokes', '0');
    expect(await inkAt(canvas, 0.45, 0.3)).toBe(0);
    await win.getByRole('button', { name: 'Undo' }).click();
    await expect(canvas).toHaveAttribute('data-strokes', '1');
    // The eraser and colours are tools like the others.
    await win.getByRole('radio', { name: 'Eraser' }).click();
    await expect(win.getByRole('radio', { name: 'Eraser' })).toHaveAttribute('aria-checked', 'true');
    await win.getByRole('radio', { name: 'Blue' }).click();
    await expect(win.getByRole('radio', { name: 'Blue' })).toHaveAttribute('aria-checked', 'true');
    expect(errors).toEqual([]);
  });

  test('when the live socket can’t open, each drawing goes as one POST; Finish starts a Sketch finish job', async ({ page }) => {
    const { posts, jobs } = await mockStudio(page);
    await mockSocket(page, { refuse: true });
    const { win, errors } = await openMake(page);
    const canvas = win.getByRole('img', { name: 'Your drawing', exact: true });
    await win.getByRole('textbox', { name: 'What is it?' }).fill('a red fox');
    await stroke(canvas, line(0.5, 0.8));
    await stroke(canvas, line(0.7, 0.8));
    await expect.poll(() => posts.length, { timeout: 15_000 }).toBeGreaterThan(0);
    expect(posts.at(-1)).toMatchObject({ prompt: 'a red fox', follow: 0.6 });
    expect(String(posts.at(-1)!.image)).toMatch(/^data:image\/png;base64,/);
    await expect(win.getByRole('img', { name: 'Live picture of your drawing' })).toHaveAttribute('src', /^blob:/);
    // Finish: the drawing (1024 × 1024 lines) and the words, as a Sketch finish job.
    await win.locator('.ld-follow input').fill('1');
    await win.getByRole('button', { name: 'Finish' }).click();
    await expect.poll(() => jobs.length).toBe(1);
    expect(jobs[0]).toMatchObject({ kind: 'image', maker: 'sketch-finish', prompt: 'a red fox', follow: 1, size: 'square' });
    expect(String(jobs[0].image)).toMatch(/^data:image\/png;base64,/);
    await expect(win.locator('.ai-job').first()).toContainText('a cat');
    expect(errors).toEqual([]);
  });

  test('without the makers: drawing still works, and the page says how to get them', async ({ page }) => {
    await mockStudio(page, { live: false, finish: false });
    const { win, errors } = await openMake(page);
    const canvas = win.getByRole('img', { name: 'Your drawing', exact: true });
    await stroke(canvas, line(0.5, 0.8));
    await expect(canvas).toHaveAttribute('data-strokes', '1');
    await expect(win.locator('.ld-status')).toContainText('Add Live draw in the Store');
    await expect(win.getByText('Add Sketch finish in the Store')).toBeVisible();
    await expect(win.getByRole('button', { name: 'Finish' })).toBeDisabled();
    await expectNoHorizontalOverflow(page);
    await win.getByRole('button', { name: 'Get Live draw' }).click();
    const store = page.locator('.app-window[data-app="store"]');
    await expect(store.getByRole('region', { name: 'Live', exact: true })).toContainText('Live draw (pix2pix-turbo)');
    await expect(store.getByRole('region', { name: 'Live', exact: true })).toContainText('Sketch finish (Z-Image)');
    expect(errors).toEqual([]);
  });
});
