import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { readPsd } from 'ag-psd';
import { expectNoHorizontalOverflow } from './helpers';

/**
 * Live Draw (its own app, Orbit 0.5): the drawing machine starts from its card, strokes go up over a
 * (mocked) WebSocket and a stand-in picture comes back under them, Ink fades the strokes, Keep and
 * Paint over send a base and a mask, the sketch reader's guesses fill the words, Finish lands in the
 * gallery, Bring to life streams over the live video socket, and the PNG downloads. Make's "Draw it"
 * opens it. The drawing studio: GPU brushes, the brush library and maker, colour, layers (blend
 * modes, masks, merge, PSD), vector ink, guides and the gestures. Chromium with emulated devices:
 * Safari's own Pencil behaviour is not tested here.
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

/** Open the studio with the machine left off ("Just draw for now"). */
async function openStudio(page: Page) {
  const win = await openLiveDraw(page);
  await win.getByRole('button', { name: 'Just draw for now' }).click();
  await expect(win.locator('canvas[data-layer="art"][data-engine]')).toHaveCount(1);
  return win;
}

/** A stroke made of real PointerEvents. */
async function stroke(paper: Locator, pts: [number, number][], pointerType = 'mouse', opts: { id?: number; holdMs?: number } = {}) {
  await paper.evaluate(
    async (el, { pts, pointerType, id, holdMs }) => {
      const r = el.getBoundingClientRect();
      const fire = (type: string, [x, y]: [number, number], buttons: number) =>
        el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: id, pointerType, isPrimary: true, pressure: buttons ? 0.6 : 0, tiltX: 20, button: 0, buttons, clientX: r.left + x * r.width, clientY: r.top + y * r.height }));
      fire('pointerdown', pts[0], 1);
      for (const p of pts.slice(1)) fire('pointermove', p, 1);
      if (holdMs) await new Promise((res) => setTimeout(res, holdMs));
      fire('pointerup', pts[pts.length - 1], 0);
    },
    { pts, pointerType, id: opts.id ?? 3, holdMs: opts.holdMs ?? 0 },
  );
}

/** Several fingers at once: a tap (no movement) or a pinch (each finger moves by its delta, in paper widths). */
async function fingers(paper: Locator, at: [number, number][], move: [number, number][] | null = null, holdMs = 0) {
  await paper.evaluate(
    async (el, { at, move, holdMs }) => {
      const r = el.getBoundingClientRect();
      const xy = ([x, y]: [number, number]) => ({ clientX: r.left + x * r.width, clientY: r.top + y * r.height });
      const fire = (type: string, i: number, p: { clientX: number; clientY: number }) =>
        el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 100 + i, pointerType: 'touch', isPrimary: i === 0, pressure: 0.5, buttons: type === 'pointerup' ? 0 : 1, ...p }));
      at.forEach((p, i) => fire('pointerdown', i, xy(p)));
      if (move)
        for (let step = 1; step <= 6; step++)
          at.forEach((p, i) => {
            const s = xy(p);
            fire('pointermove', i, { clientX: s.clientX + (move[i][0] * r.width * step) / 6, clientY: s.clientY + (move[i][1] * r.width * step) / 6 });
          });
      if (holdMs) await new Promise((res) => setTimeout(res, holdMs));
      at.forEach((p, i) => {
        const s = xy(p);
        fire('pointerup', i, move ? { clientX: s.clientX + move[i][0] * r.width, clientY: s.clientY + move[i][1] * r.width } : s);
      });
    },
    { at, move, holdMs },
  );
}

/** Show a panel: the side panel's tab on an iPad held sideways, the Tools sheet's tab on a phone. */
async function panel(win: Locator, name: string) {
  if (!(await win.locator('.ldx-side').count()) && !(await win.locator('.ldx-sheet').count())) await win.getByRole('button', { name: 'Tools', exact: true }).click();
  await win.getByRole('tab', { name, exact: true }).click();
}
async function closeSheet(win: Locator) {
  const sheet = win.locator('.ldx-sheet');
  if (await sheet.count()) {
    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(sheet).toHaveCount(0);
  }
}
const strokes = (paper: Locator) => paper.getAttribute('data-strokes').then(Number);

test.describe('Live Draw', () => {
  // The GPU engine runs in software here (no graphics chip): give the long walks room.
  test.describe.configure({ timeout: 120_000 });
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
    expect(order.indexOf('picture')).toBeLessThan(order.indexOf('art'));
    expect(frames[0]).toMatchObject({ type: 'frame', engine: 'fast', mode: 'live', size: 512 });
    // The contract: the Sketch layer goes as `sketch` (a PNG), nothing on Colour means no `color`.
    expect(String(frames[0].sketch)).toMatch(/^data:image\/png;base64,/);
    expect(frames[0].color).toBeUndefined();

    await win.getByRole('slider', { name: /Ink/ }).first().fill('30');
    await expect(win.locator('canvas[data-layer="art"]')).toHaveCSS('opacity', '0.3');

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

    // Paint on the Colour layer: it now goes as `color` too.
    await panel(win, 'Layers');
    await win.getByRole('button', { name: 'Colour', exact: true }).click();
    await closeSheet(win);
    await stroke(paper, [[0.3, 0.8], [0.6, 0.85]]);
    await expect.poll(() => frames.some((f) => typeof f.color === 'string' && String(f.color).startsWith('data:image/png'))).toBe(true);

    await panel(win, 'History');
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

  test('the studio: GPU brushes, colour, gestures, the quick menu, hover and palm rejection', async ({ page }) => {
    const { errors } = await setUp(page);
    const win = await openStudio(page);
    await expect(win.locator('canvas[data-layer="art"]')).toHaveAttribute('data-engine', 'webgl2');
    const paper = win.locator('.ldx-paper');

    // Every built-in brush is in the library; pick one and it draws.
    await panel(win, 'Brushes');
    for (const name of ['Technical pen', 'Ink pen', 'Pencil HB', 'Pencil 6B', 'Charcoal', 'Marker', 'Gouache', 'Soft airbrush', 'Hard airbrush', 'Spray', 'Eraser', 'Textured eraser', 'Blend']) await expect(win.getByRole('radio', { name: new RegExp(`^${name}`) }).first()).toBeAttached();
    await win.getByRole('radio', { name: /^Gouache/ }).click();
    await expect(win.getByRole('radio', { name: /^Gouache/ })).toHaveAttribute('aria-checked', 'true');
    await closeSheet(win);
    const before = await paper.screenshot();
    await stroke(paper, [[0.1, 0.3], [0.3, 0.32], [0.5, 0.3], [0.7, 0.34], [0.9, 0.3]], 'pen');
    await expect.poll(() => strokes(paper)).toBe(1);
    expect((await paper.screenshot()).equals(before)).toBe(false);

    // Colour: the wheel's hex code sets it, it joins the recent colours, a harmony offers its partner.
    await panel(win, 'Colour');
    await win.getByRole('textbox', { name: 'Colour code' }).fill('#d6452b');
    await expect(win.getByRole('group', { name: 'Recent colours' }).getByRole('button', { name: '#d6452b' })).toBeVisible();
    await win.getByRole('radio', { name: 'Complementary' }).click();
    await expect(win.getByRole('group', { name: 'Colours that go with it' }).getByRole('button')).toHaveCount(2);
    await closeSheet(win);
    await expect(win.getByRole('button', { name: 'Colour #d6452b' })).toBeVisible();

    // Two fingers tap: undo; three: redo.
    await fingers(paper, [[0.4, 0.5], [0.6, 0.5]]);
    await expect.poll(() => strokes(paper)).toBe(0);
    await fingers(paper, [[0.3, 0.5], [0.5, 0.5], [0.7, 0.5]]);
    await expect.poll(() => strokes(paper)).toBe(1);

    // Two fingers spread and twist: zoom and turn; a pinch back in snaps to the whole canvas.
    await fingers(paper, [[0.4, 0.5], [0.6, 0.5]], [[-0.15, -0.05], [0.15, 0.05]]);
    await expect.poll(() => paper.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a)).toBeGreaterThan(1.2);
    await fingers(paper, [[0.3, 0.5], [0.7, 0.5]], [[0.17, 0], [-0.17, 0]]);
    await expect.poll(() => paper.evaluate((el) => getComputedStyle(el).transform)).toMatch(/matrix\(1, 0, 0, 1, 0, 0\)|none/);

    // Long press: pick the colour under the finger (the red stroke… or paper where there is none).
    await stroke(paper, [[0.5, 0.9], [0.5, 0.9]], 'mouse', { id: 9, holdMs: 700 });
    await expect(win.getByRole('button', { name: 'Colour #ffffff' })).toBeVisible();
    expect(await strokes(paper)).toBe(1);

    // The Pencil hovering shows the brush's size.
    await paper.evaluate((el) => {
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 11, pointerType: 'pen', buttons: 0, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
    });
    await expect(win.locator('.ldx-hover')).toBeVisible();
    // With a Pencil in use a finger doesn't draw (palm rejection).
    await expect(win.locator('.ldx-pen-note')).toBeVisible();
    await stroke(paper, [[0.2, 0.6], [0.6, 0.65]], 'touch', { id: 12 });
    expect(await strokes(paper)).toBe(1);

    // The quick menu at the tip: right-click (or press and hold with two fingers).
    const box = (await paper.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
    const quick = win.getByRole('dialog', { name: 'Quick menu' });
    await expect(quick).toBeVisible();
    await expect(quick.getByRole('button', { name: 'Gouache' })).toBeVisible();
    await quick.getByRole('slider', { name: 'Size' }).fill('2');
    await quick.getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => strokes(paper)).toBe(0);
    await page.keyboard.press('Escape');
    await expect(quick).toHaveCount(0);
    await fingers(paper, [[0.4, 0.5], [0.6, 0.5]], null, 800);
    await expect(win.getByRole('dialog', { name: 'Quick menu' })).toBeVisible();
    await page.keyboard.press('Escape');

    // Four fingers: only the canvas; the button brings the tools back.
    await fingers(paper, [[0.2, 0.5], [0.4, 0.5], [0.6, 0.5], [0.8, 0.5]]);
    await expect(win.locator('.ldx-top')).toBeHidden();
    await win.getByRole('button', { name: 'Show the tools' }).click();
    await expect(win.locator('.ldx-top')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });

  test('the studio: layers with blend modes and masks, ink you can edit, guides, the brush maker, PSD', async ({ page }) => {
    const { errors } = await setUp(page);
    const win = await openStudio(page);
    const paper = win.locator('.ldx-paper');
    await stroke(paper, [[0.2, 0.2], [0.8, 0.25]], 'pen');

    // Layers: add, blend, opacity, lock, mask, duplicate, merge, reorder.
    await panel(win, 'Layers');
    const rows = win.getByRole('list', { name: 'Layers' }).locator('.ldx-lrow');
    await expect(rows).toHaveCount(2);
    await win.getByRole('button', { name: 'Layer', exact: true }).click();
    await expect(rows).toHaveCount(3);
    await win.getByRole('combobox', { name: 'Blend mode' }).selectOption('multiply');
    await win.getByRole('switch', { name: /Lock transparency/ }).click();
    await expect(win.getByRole('switch', { name: /Lock transparency/ })).toHaveAttribute('aria-checked', 'true');
    await win.getByRole('switch', { name: /Lock transparency/ }).click();
    await win.getByRole('textbox', { name: 'Layer name' }).fill('Shadows');
    await win.getByRole('button', { name: 'Add a mask' }).click();
    await expect(win.getByRole('switch', { name: /Paint on the mask/ })).toHaveAttribute('aria-checked', 'true');
    await win.getByRole('switch', { name: /Paint on the mask/ }).click();
    await closeSheet(win);
    await stroke(paper, [[0.3, 0.6], [0.7, 0.62]], 'pen');
    await panel(win, 'Layers');
    await expect(rows.first()).toContainText('Shadows');
    await expect(rows.first()).toContainText('Multiply');
    await win.getByRole('button', { name: 'Duplicate', exact: true }).click();
    await expect(rows).toHaveCount(4);
    await win.getByRole('button', { name: 'Merge down' }).click();
    await expect(rows).toHaveCount(3);
    await win.getByRole('button', { name: 'Down', exact: true }).click();
    await expect(rows.nth(1)).toContainText('Shadows');
    await expect(win.locator('.ldx-thumb-sm img').first()).toBeAttached();

    // Save the layers: the PSD keeps names, blend modes and order.
    await panel(win, 'History');
    const [psd] = await Promise.all([page.waitForEvent('download'), win.getByRole('button', { name: 'Save layers (PSD)' }).click()]);
    expect(psd.suggestedFilename()).toMatch(/\.psd$/);
    const doc = readPsd(readFileSync((await psd.path())!), { skipLayerImageData: true, skipCompositeImageData: true, skipThumbnail: true, useImageData: true });
    const names = (doc.children ?? []).map((c) => c.name);
    expect(names).toEqual(['Paper', 'Colour', 'Shadows', 'Sketch']);
    expect(doc.children?.find((c) => c.name === 'Shadows')?.blendMode).toBe('multiply');

    // An ink layer: strokes stay editable (select one, change its width, delete it).
    await panel(win, 'Layers');
    await win.getByRole('button', { name: 'Ink layer' }).click();
    await closeSheet(win);
    const before = await strokes(paper);
    await stroke(paper, [[0.2, 0.45], [0.5, 0.47], [0.8, 0.45]], 'pen');
    await expect.poll(() => strokes(paper)).toBe(before + 1);
    if (await win.locator('.ldx-rail').count()) await win.getByRole('radio', { name: 'Edit ink' }).click();
    else {
      await panel(win, 'Brushes');
      await win.getByRole('radio', { name: /Edit ink/ }).click();
      await closeSheet(win);
    }
    await stroke(paper, [[0.5, 0.465], [0.5, 0.465]], 'pen');
    const bar = win.getByRole('group', { name: 'Selected ink stroke' }).last();
    await expect(bar).toBeVisible();
    await bar.getByRole('slider', { name: 'Width' }).fill('0.03');
    await bar.getByRole('button', { name: 'Delete' }).click();
    await expect.poll(() => strokes(paper)).toBe(before);

    // Guides: perspective grid with vanishing points; radial symmetry draws every stroke N times.
    await panel(win, 'Guides');
    await win.getByRole('radio', { name: '2 point' }).click();
    await expect(win.locator('.ldx-guide').first()).toBeAttached();
    await expect(win.getByRole('slider', { name: 'Vanishing point 1' })).toBeAttached();
    await win.getByRole('radio', { name: 'Radial' }).click();
    await expect(win.locator('.ldx-axis')).toHaveCount(6);
    await win.getByRole('switch', { name: /Rotational/ }).click();
    await win.getByRole('slider', { name: 'Pulled string' }).fill('0.5');
    // (Perspective off again: with it on, every stroke runs straight toward a vanishing point.)
    await win.getByRole('radiogroup', { name: 'Perspective' }).getByRole('radio', { name: 'Off' }).click();
    await win.getByRole('button', { name: 'Done moving points' }).click();
    await closeSheet(win);

    // The brush maker: change a brush, save it as yours, take it away and bring it back.
    await win.getByRole('radio', { name: 'Brush', exact: true }).first().click();
    // Hold still at the end of a rough circle: it snaps to a clean one.
    const ring = Array.from({ length: 48 }, (_, i): [number, number] => [0.5 + 0.2 * Math.cos((i / 47) * Math.PI * 2) + (i % 3) * 0.002, 0.5 + 0.2 * Math.sin((i / 47) * Math.PI * 2)]);
    await stroke(paper, ring, 'pen', { holdMs: 900 });
    await expect(page.getByText(/Snapped to an ellipse/)).toBeVisible();
    await panel(win, 'Brushes');
    await win.getByRole('button', { name: 'Change this brush' }).click();
    const maker = win.getByRole('dialog').filter({ hasText: 'Brush maker' });
    await maker.getByRole('textbox', { name: 'Brush name' }).fill('My chalk');
    await maker.getByRole('tab', { name: 'Grain' }).click();
    await maker.getByRole('radio', { name: 'Paper' }).first().click();
    await maker.getByRole('tab', { name: 'Pressure & tilt' }).click();
    await maker.getByRole('button', { name: 'Light touch' }).click();
    const [file] = await Promise.all([page.waitForEvent('download'), maker.getByRole('button', { name: /Take it away/ }).click()]);
    expect(file.suggestedFilename()).toBe('my-chalk.brush.json');
    const json = JSON.parse(readFileSync((await file.path())!, 'utf8'));
    expect(json).toMatchObject({ kind: 'orbit-live-draw-brush', brush: { name: 'My chalk', grain: 'paper' } });
    await maker.getByRole('button', { name: 'Save as my brush' }).click();
    await expect(page.getByText('Saved “My chalk” to your brushes.')).toBeVisible();
    await panel(win, 'Brushes');
    await expect(win.getByRole('radiogroup', { name: 'Mine brushes' }).getByRole('radio', { name: /My chalk/ })).toHaveAttribute('aria-checked', 'true');
    await win.locator('input[type="file"][aria-label="Brush file"]').setInputFiles({ name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...json, brush: { ...json.brush, name: 'Brought in' } })) });
    await expect(win.getByRole('radio', { name: /Brought in/ })).toBeVisible();
    await closeSheet(win);
    // The symmetric stroke with the new brush on the active ink layer is one more stroke… on a paint layer.
    await panel(win, 'Layers');
    await win.getByRole('button', { name: /^Sketch/ }).click();
    await closeSheet(win);
    const n = await strokes(paper);
    await stroke(paper, [[0.55, 0.3], [0.6, 0.2], [0.7, 0.15]], 'pen');
    await expect.poll(() => strokes(paper)).toBe(n + 1);
    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });
});
