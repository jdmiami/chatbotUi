import { expect, test, type Locator, type Page } from '@playwright/test';
import { expectNoHorizontalOverflow } from './helpers';

/**
 * Live Draw (its own app, Orbit 0.5): the drawing machine starts from its card, strokes go up over a
 * (mocked) WebSocket and a stand-in picture comes back under them, Ink fades the strokes, Keep and
 * Paint over send a base and a mask, the sketch reader's guesses fill the words, Finish lands in the
 * gallery, Bring to life streams over the live video socket, and the PNG downloads. Make's "Draw it"
 * opens it. Chromium with emulated devices: Safari's own Pencil behaviour is not tested here.
 */

// A 1×1 JPEG stands in for every picture.
const PIC = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

async function setUp(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    if (!localStorage.getItem('orbit:shell:v1'))
      localStorage.setItem('orbit:shell:v1', JSON.stringify({ state: { settings: { orb: false, motion: 'reduce', motionPicked: true, introSeen: true } }, version: 0 }));
  });
  let state = 'off';
  await page.route('**/api/canvas', (r) => {
    if (r.request().method() === 'POST') state = r.request().postDataJSON().action === 'start' ? 'on' : 'off';
    return r.fulfill({ json: { state, pricePerHour: 1.89, costPerHour: 1.79, autoOffMinutes: 20 } });
  });
  await page.route('**/api/canvas/token', (r) =>
    r.fulfill({ json: { status: state, url: state === 'on' ? `${new URL(page.url()).origin}/fake-canvas` : null, token: state === 'on' ? 'tok' : null, expiresIn: 3600, engine: 'fast' } }),
  );
  await page.route('**/fake-canvas/**', (r) => {
    const path = new URL(r.request().url()).pathname.replace('/fake-canvas', '');
    if (path === '/_orbit/canvas') return r.fulfill({ json: { engines: { fast: 'ready', licensed: 'off' }, living: 'ready', animate: 'off', finish: 'ready', reader: 'ready' } });
    if (path === '/_orbit/canvas/read') return r.fulfill({ json: { guesses: [{ label: 'a house', prompt: 'a little house on a hill' }, { label: 'a boat', prompt: 'a boat' }] } });
    if (path === '/_orbit/canvas/finish') return r.fulfill({ json: { id: 'f1', kind: 'image', prompt: 'p', status: 'done', progress: 100, error: null, createdAt: '', item: { id: 'i', kind: 'image', prompt: 'p', createdAt: '', url: PIC } } });
    return r.fulfill({ json: { ok: true } });
  });
  const frames: Record<string, unknown>[] = [];
  await page.routeWebSocket(/\/fake-canvas\/_orbit\/canvas\/live$/, (ws) => {
    ws.onMessage((m) => {
      const f = JSON.parse(String(m));
      frames.push(f);
      ws.send(JSON.stringify({ type: 'frame', id: f.id, image: PIC, ms: 80 }));
    });
  });
  const life: Record<string, unknown>[] = [];
  await page.routeWebSocket(/\/fake-canvas\/_orbit\/live\/video$/, (ws) => {
    ws.onMessage((m) => {
      const msg = JSON.parse(String(m));
      life.push(msg);
      if (msg.type === 'start') ws.send(JSON.stringify({ type: 'state', state: 'live' }));
      if (msg.type === 'frame') ws.send(JSON.stringify({ type: 'frame', image: PIC }));
      if (msg.type === 'save') ws.send(JSON.stringify({ type: 'saved', item: null }));
    });
  });
  return { errors, frames, life };
}

async function openLiveDraw(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /^Index/ }).click();
  await page.getByRole('dialog', { name: 'Index' }).locator('.o5-index-list').getByRole('button', { name: /Live Draw/ }).click();
  return page.locator('.app-window[data-app="livedraw"]');
}

/** A stroke made of real PointerEvents. */
async function stroke(paper: Locator, pts: [number, number][], pointerType = 'mouse') {
  await paper.evaluate(
    (el, { pts, pointerType }) => {
      const r = el.getBoundingClientRect();
      const fire = (type: string, [x, y]: [number, number]) =>
        el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 3, pointerType, isPrimary: true, pressure: 0.6, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: r.left + x * r.width, clientY: r.top + y * r.height }));
      fire('pointerdown', pts[0]);
      for (const p of pts.slice(1)) fire('pointermove', p);
      fire('pointerup', pts[pts.length - 1]);
    },
    { pts, pointerType },
  );
}

test.describe('Live Draw', () => {
  test('start the drawing machine, draw, and the picture appears under the strokes', async ({ page }) => {
    const { errors, frames, life } = await setUp(page);
    const win = await openLiveDraw(page);
    const card = win.getByRole('dialog', { name: /become a picture/ });
    await expect(card).toContainText('$1.89 an hour');
    await expect(card).toContainText('turns itself off after 20 minutes');
    await expect(card).not.toContainText(/pod|gpu|runpod/i);
    await card.getByRole('button', { name: 'Start', exact: true }).click();
    await expect(card).toHaveCount(0);

    const paper = win.locator('.ldx-paper');
    await stroke(paper, [[0.2, 0.7], [0.4, 0.4], [0.6, 0.7]]);
    await expect(win.locator('img.ldx-picture')).toBeVisible();
    // The picture sits under the strokes.
    const order = await paper.evaluate((el) => [...el.children].map((c) => c.getAttribute('data-layer') ?? 'picture'));
    expect(order.indexOf('picture')).toBeLessThan(order.indexOf('sketch'));
    expect(frames[0]).toMatchObject({ type: 'frame', engine: 'fast', mode: 'live', size: 512 });

    await win.getByRole('slider', { name: /Ink/ }).first().fill('30');
    await expect(win.locator('canvas[data-layer="sketch"]')).toHaveCSS('opacity', '0.3');

    await win.getByRole('button', { name: 'Keep' }).click();
    await stroke(paper, [[0.7, 0.2], [0.8, 0.3]]);
    await expect.poll(() => frames.some((f) => typeof f.base === 'string')).toBe(true);

    await win.getByRole('radio', { name: /Paint over/ }).click();
    await stroke(paper, [[0.2, 0.2], [0.5, 0.2]]);
    await expect.poll(() => frames.some((f) => f.mode === 'paint' && typeof f.mask === 'string')).toBe(true);
    await win.getByRole('radio', { name: /^Live/ }).click();

    // The sketch reader offers guesses once you stop (no words yet); a guess fills the words.
    await expect(win.getByRole('list', { name: 'Guesses' })).toBeVisible({ timeout: 8000 });
    await win.getByRole('button', { name: /a house/ }).click();
    await expect(win.getByRole('textbox', { name: 'What is it?' })).toHaveValue('a little house on a hill');

    await win.getByRole('button', { name: 'Bring to life' }).click();
    await expect(win.locator('img.ldx-picture[data-living]')).toBeVisible();
    expect(life[0]).toMatchObject({ type: 'start', maker: 'live-krea', source: 'canvas' });
    await win.getByRole('button', { name: /Save last 10 s/ }).click();
    await expect(page.getByText('Saved the last 10 seconds to your gallery.')).toBeVisible();
    await win.getByRole('button', { name: 'Stop', exact: true }).click();

    if (!(await win.locator('.ldx-side').count())) {
      await win.getByRole('button', { name: 'Tools', exact: true }).click();
      await win.getByRole('tab', { name: 'History' }).click();
    }
    const [png] = await Promise.all([page.waitForEvent('download'), win.getByRole('button', { name: 'Save PNG' }).click()]);
    expect(png.suggestedFilename()).toMatch(/^live-draw-.*\.png$/);
    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });

  test('Make has no Live draw or Live video any more; “Draw it” opens Live Draw', async ({ page }) => {
    const { errors } = await setUp(page);
    await page.goto('/');
    await page.getByRole('button', { name: /^Index/ }).click();
    await page.getByRole('dialog', { name: 'Index' }).locator('.o5-index-list').getByRole('button', { name: /^\d*\s*Make/ }).click();
    const make = page.locator('.app-window[data-app="make"]');
    await expect(make.getByRole('radio', { name: /A picture/ })).toBeVisible();
    await expect(make.getByRole('radio', { name: /Live draw|Live video/ })).toHaveCount(0);
    await make.getByRole('button', { name: /Draw it/ }).click();
    await expect(page.locator('.app-window[data-app="livedraw"]')).toBeVisible();
    expect(errors).toEqual([]);
  });
});
