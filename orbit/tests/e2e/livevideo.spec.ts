import { expect, test, type Locator, type Page } from '@playwright/test';
import { expectNoHorizontalOverflow } from './helpers';
import { mockAi } from './aiMocks';

/**
 * Live video in Make (Orbit 0.5): the camera (a fake one: a moving canvas stream stands in for
 * getUserMedia), a drawing or just words, streamed to a mocked AI machine over the WebSocket, frames
 * back, words changed while it runs, Save last 10 s and Stop. Chromium with emulated devices: a real
 * iPad camera and Safari are not tested here.
 */

const JPEG_B64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

async function openLive(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    if (!localStorage.getItem('orbit:shell:v1'))
      localStorage.setItem('orbit:shell:v1', JSON.stringify({ state: { settings: { orb: false, motion: 'reduce', motionPicked: true, skin: 'o5', introSeen: true } }, version: 0 }));
    // A camera: a canvas with a moving square, as a MediaStream.
    const fake = async () => {
      const c = document.createElement('canvas');
      c.width = 640;
      c.height = 480;
      const g = c.getContext('2d')!;
      let x = 0;
      setInterval(() => {
        g.fillStyle = '#246';
        g.fillRect(0, 0, 640, 480);
        g.fillStyle = '#fc0';
        g.fillRect((x = (x + 9) % 600), 200, 40, 40);
      }, 40);
      (window as unknown as { __cameraAsked: number }).__cameraAsked = ((window as unknown as { __cameraAsked?: number }).__cameraAsked ?? 0) + 1;
      return c.captureStream(25);
    };
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: fake }, configurable: true });
  });
  await page.goto('/');
  await page.getByRole('button', { name: /^Index/ }).click();
  await page.getByRole('dialog', { name: 'Index' }).getByRole('button', { name: /Talk/ }).click();
  const win = page.locator('.app-window[data-app="ai"]');
  await win.getByRole('button', { name: 'Make', exact: true }).click();
  await win.getByRole('radio', { name: /Live video/ }).click();
  return { win, errors };
}

async function mockStudio(page: Page, { sdv2 = true, krea = true } = {}) {
  await mockAi(page, 'on');
  const ready = { ready: true, downloaded: true, percent: 100 };
  await page.route('**/fake-ai/_orbit/studio', (r) => r.fulfill({ json: { setup: 'running', running: true, image: ready, video: ready, downloading: null, downloadError: null, jobs: [] } }));
  const items: Record<string, unknown>[] = [];
  await page.route('**/fake-ai/_orbit/studio/items', (r) => r.fulfill({ json: { items } }));
  await page.route('**/fake-ai/_orbit/studio/makers', (r) =>
    r.fulfill({
      json: {
        makers: [
          { id: 'qwen', kind: 'image', name: 'Qwen Uncensored', installed: true, builtIn: true, wanted: true, percent: 100 },
          { id: 'live-sdv2', kind: 'live', name: 'Live video (StreamDiffusionV2)', installed: sdv2, wanted: sdv2, percent: sdv2 ? 100 : 0 },
          { id: 'live-krea', kind: 'live', name: 'Krea Realtime 14B', installed: krea, wanted: krea, percent: krea ? 100 : 0, turboOnly: true },
        ],
      },
    }),
  );
  const got: Record<string, unknown>[] = [];
  await page.routeWebSocket(/\/_orbit\/live\/video$/, (ws) => {
    let start: Record<string, unknown> | null = null;
    let words: ReturnType<typeof setInterval> | null = null;
    ws.onMessage((m) => {
      const msg = JSON.parse(String(m));
      got.push(msg);
      if (msg.type === 'start') {
        start = msg;
        ws.send(JSON.stringify({ type: 'state', state: 'loading' }));
        setTimeout(() => ws.send(JSON.stringify({ type: 'state', state: 'live' })), 50);
        // Words only: the machine makes frames by itself.
        if (msg.source === 'text') words = setInterval(() => ws.send(JSON.stringify({ type: 'frame', image: `data:image/jpeg;base64,${JPEG_B64}` })), 100);
      }
      if (msg.type === 'frame') ws.send(JSON.stringify({ type: 'frame', image: `data:image/jpeg;base64,${JPEG_B64}`, ms: 120 }));
      if (msg.type === 'prompt') ws.send(JSON.stringify({ type: 'prompt', prompt: msg.prompt }));
      if (msg.type === 'save') {
        const item = { id: 'live1', kind: 'video', maker: start?.maker, prompt: start?.prompt, url: '/fake-ai/_orbit/studio/file/live1', seconds: 10, createdAt: '2026-10-21T00:00:00Z' };
        items.unshift(item);
        ws.send(JSON.stringify({ type: 'saved', item }));
      }
      if (msg.type === 'stop') {
        if (words) clearInterval(words);
        ws.send(JSON.stringify({ type: 'state', state: 'stopped' }));
      }
    });
  });
  return { got, items };
}

async function expectTappable(win: Locator) {
  const boxes = await win.locator('.lv button:visible, .lv input:visible').evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { name: el.getAttribute('aria-label') || el.textContent?.trim() || '?', w: r.width, h: r.height };
    }),
  );
  for (const b of boxes) expect(Math.min(b.w, b.h), `${b.name} is big enough to tap`).toBeGreaterThanOrEqual(44);
}

test.describe('Live video', () => {
  test('camera: frames stream up as 512 × 512 JPEGs, restyled frames come back; new words while it runs; Save last 10 s; Stop', async ({ page }, testInfo) => {
    const { got, items } = await mockStudio(page);
    const { win, errors } = await openLive(page);
    await expect(win.getByRole('heading', { name: 'Go live' })).toBeAttached();
    const start = win.getByRole('button', { name: 'Start' });
    await expect(start).toBeDisabled();
    await win.getByRole('textbox', { name: 'Describe the look' }).fill('a watercolour painting');
    await expect(start).toBeEnabled();
    await expectNoHorizontalOverflow(page);
    await expectTappable(win);
    await start.click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __cameraAsked?: number }).__cameraAsked)).toBe(1);
    await expect.poll(() => got.find((m) => m.type === 'start')).toMatchObject({ maker: 'live-sdv2', source: 'camera', prompt: 'a watercolour painting', strength: 0.7 });
    await expect.poll(() => got.filter((m) => m.type === 'frame').length, { timeout: 10_000 }).toBeGreaterThan(3);
    const f = got.find((m) => m.type === 'frame')!;
    expect(String(f.image)).toMatch(/^data:image\/jpeg;base64,/);
    const size = await page.evaluate(async (src) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      return [img.naturalWidth, img.naturalHeight];
    }, String(f.image));
    expect(size).toEqual([512, 512]);
    await expect(win.getByRole('img', { name: 'Live video from your AI machine' })).toBeVisible();
    await expect(win.locator('.lv .ld-status')).toContainText(/Live · about [\d.]+ frames a second/);
    await win.locator('.lv').scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('live-video.png') });
    // New words while it runs.
    await win.getByRole('textbox', { name: 'Describe the look' }).fill('a pencil sketch');
    await expect.poll(() => got.filter((m) => m.type === 'prompt').map((m) => m.prompt)).toEqual(['a pencil sketch']);
    // The end of it, into the gallery.
    await win.getByRole('button', { name: 'Save last 10 s' }).click();
    await expect.poll(() => got.some((m) => m.type === 'save')).toBe(true);
    await expect(page.getByText('Saved the last 10 seconds to your gallery.')).toBeVisible();
    expect(items.length).toBe(1);
    await win.getByRole('button', { name: 'Stop' }).click();
    await expect.poll(() => got.some((m) => m.type === 'stop')).toBe(true);
    await expect(win.getByRole('button', { name: 'Start' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });

  test('drawing: the pad streams what you draw with the Pencil', async ({ page }) => {
    const { got } = await mockStudio(page);
    const { win, errors } = await openLive(page);
    await win.getByRole('radio', { name: /Drawing/ }).click();
    const pad = win.getByRole('img', { name: 'Your drawing', exact: true });
    await expect(pad).toBeVisible();
    // Only the live video's own output pane: the pad has no preview of its own.
    await expect(win.locator('.lv .ld-preview')).toHaveCount(1);
    await win.getByRole('textbox', { name: 'Describe the look' }).fill('neon line art');
    await win.getByRole('button', { name: 'Start' }).click();
    await pad.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const fire = (type: string, i: number) =>
        el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 3, pointerType: 'pen', pressure: 0.7, clientX: r.left + r.width * (0.2 + i * 0.05), clientY: r.top + r.height / 2, buttons: type === 'pointerup' ? 0 : 1 }));
      fire('pointerdown', 0);
      for (let i = 1; i < 10; i++) fire('pointermove', i);
      fire('pointerup', 10);
    });
    await expect(pad).toHaveAttribute('data-strokes', '1');
    await expect.poll(() => got.find((m) => m.type === 'start')?.source).toBe('canvas');
    await expect.poll(() => got.filter((m) => m.type === 'frame').length, { timeout: 10_000 }).toBeGreaterThan(2);
    expect(await page.evaluate(() => (window as unknown as { __cameraAsked?: number }).__cameraAsked ?? 0)).toBe(0);
    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });

  test('Krea Realtime: words only, the Turbo and licence note; without the maker it says how to get it', async ({ page }) => {
    const { got } = await mockStudio(page, { sdv2: false });
    const { win, errors } = await openLive(page);
    // StreamDiffusionV2 not added: Start stays off, a way to get it.
    await win.getByRole('textbox', { name: 'Describe the look' }).fill('a fox in the snow');
    await expect(win.getByRole('radio', { name: /StreamDiffusionV2/ })).toContainText('not added');
    await expect(win.getByRole('button', { name: 'Start' })).toBeDisabled();
    await expect(win.getByRole('button', { name: 'Get StreamDiffusionV2' })).toBeVisible();
    // No "Words only" for StreamDiffusionV2.
    await expect(win.getByRole('radio', { name: /Words only/ })).toHaveCount(0);
    await win.getByRole('radio', { name: /Krea Realtime 14B/ }).click();
    await expect(win.getByRole('note')).toContainText('Turbo machine only (H100, 80 GB)');
    await expect(win.getByRole('note')).toContainText('non-commercial');
    await win.getByRole('radio', { name: /Words only/ }).click();
    await win.getByRole('button', { name: 'Start' }).click();
    await expect.poll(() => got.find((m) => m.type === 'start')).toMatchObject({ maker: 'live-krea', source: 'text', prompt: 'a fox in the snow' });
    await expect(win.getByRole('img', { name: 'Live video from your AI machine' })).toBeVisible();
    // Nothing is sent up from words-only, and the camera never starts.
    await page.waitForTimeout(400);
    expect(got.filter((m) => m.type === 'frame').length).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { __cameraAsked?: number }).__cameraAsked ?? 0)).toBe(0);
    await win.getByRole('button', { name: 'Stop' }).click();
    await expectTappable(win);
    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });
});
