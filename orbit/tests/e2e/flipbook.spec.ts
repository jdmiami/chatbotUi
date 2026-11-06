import { expect, test, type Page } from '@playwright/test';
import { expectNoHorizontalOverflow, isTablet, openApp } from './helpers';

/**
 * Flipbook, stage 1: the U of paper notes. On iPad the pen draws on the note in the middle, a finger
 * turns the notes (a half-lifted note springs back), onion view lays out the notes either side as
 * cards with their ghosts, it plays, undoes, and keeps the drawing after a reload. On iPhone it is a
 * viewer. The Pencil is stood in for by pointer events marked "pen" (Chromium, emulated devices).
 */

async function setUp(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    if (!localStorage.getItem('orbit:shell:v1'))
      localStorage.setItem('orbit:shell:v1', JSON.stringify({ state: { settings: { orb: false, motion: 'reduce', motionPicked: true, introSeen: true } }, version: 0 }));
  });
  await page.goto('/');
  const win = await openApp(page, 'flipbook');
  return { errors, win };
}

/** One pointer event on the desk (a pen, a finger or the mouse). */
function fire(page: Page, type: string, x: number, y: number, pointerType: 'pen' | 'touch' | 'mouse', id: number) {
  return page.evaluate(
    ([type, x, y, pointerType, id]) => {
      document.querySelector('.fb-desk')!.dispatchEvent(
        new PointerEvent(type as string, { clientX: x as number, clientY: y as number, pointerType: pointerType as string, pointerId: id as number, bubbles: true, isPrimary: true, pressure: 0.6, button: 0, buttons: 1 }),
      );
    },
    [type, x, y, pointerType, id] as const,
  );
}

async function paper(page: Page) {
  const box = await page.locator('.fb-ink').boundingBox();
  if (!box) throw new Error('no drawing note');
  return box;
}

/** A pen line across the note, in the note's own units. */
async function penLine(page: Page, from: [number, number], to: [number, number]) {
  const b = await paper(page);
  const at = (u: number, v: number) => [b.x + u * b.width, b.y + v * b.height] as const;
  await fire(page, 'pointerdown', ...at(...from), 'pen', 9);
  for (let i = 1; i <= 6; i++) await fire(page, 'pointermove', ...at(from[0] + ((to[0] - from[0]) * i) / 6, from[1] + ((to[1] - from[1]) * i) / 6), 'pen', 9);
  await fire(page, 'pointerup', ...at(...to), 'pen', 9);
}

/** A finger drag up (forward) or down (back) at the desk's left edge, holding still before letting go. */
async function thumb(page: Page, dy: number) {
  const b = await paper(page);
  const x = 12;
  const y = b.y + b.height / 2;
  await fire(page, 'pointerdown', x, y, 'touch', 3);
  for (let i = 1; i <= 8; i++) await fire(page, 'pointermove', x, y + (dy * i) / 8, 'touch', 3);
  await page.waitForTimeout(160);
  await fire(page, 'pointerup', x, y + dy, 'touch', 3);
}

const inkPixels = (page: Page) =>
  page.locator('.fb-ink').evaluate((cv: HTMLCanvasElement) => {
    const d = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 16) if (d[i] < 90 && d[i + 1] < 90 && d[i + 2] < 90) n++;
    return n;
  });

test.describe('Flipbook on iPad', () => {
  test.beforeEach(({}, testInfo) => test.skip(!isTablet(testInfo), 'iPad draws; iPhone is a viewer'));

  test('the U: the note to draw on at the bottom middle, a full stack of notes in each top corner', async ({ page }) => {
    const { errors, win } = await setUp(page);
    const desk = (await win.locator('.fb-desk').boundingBox())!;
    const note = await paper(page);
    expect(Math.abs(note.x + note.width / 2 - (desk.x + desk.width / 2))).toBeLessThan(2);
    expect(note.y + note.height).toBeLessThanOrEqual(desk.y + desk.height + 1);
    expect(note.width).toBeGreaterThan(300);
    const next = (await win.locator('.fb-pile[data-side="next"]').boundingBox())!;
    const done = (await win.locator('.fb-pile[data-side="done"]').boundingBox())!;
    expect(next.x + next.width).toBeLessThan(desk.x + desk.width / 2);
    expect(done.x).toBeGreaterThan(desk.x + desk.width / 2);
    expect(next.y + next.height).toBeLessThan(note.y);
    await expect(win.locator('.fb-frame')).toHaveText('Frame 1 of 1');
    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });

  test('the pen draws; a finger turns the notes; a half-lifted note springs back; it keeps after a reload', async ({ page }) => {
    const { errors, win } = await setUp(page);
    const frame = win.locator('.fb-frame');
    expect(await inkPixels(page)).toBe(0);
    await penLine(page, [0.5, 0.2], [0.5, 0.7]);
    expect(await inkPixels(page)).toBeGreaterThan(20);

    // A finger on the note does not draw (pen only): it turns the pad to the waiting blank note.
    await thumb(page, -260);
    await expect(frame).toHaveText('New note · 1 so far');
    expect(await inkPixels(page)).toBe(0);
    await penLine(page, [0.3, 0.3], [0.7, 0.6]);
    await expect(frame).toHaveText('Frame 2 of 2');

    // Peek: lift the note part way and let go. It springs back to the same note.
    await thumb(page, -60);
    await expect(frame).toHaveText('Frame 2 of 2');
    await thumb(page, 60);
    await expect(frame).toHaveText('Frame 2 of 2');

    // A whole note back.
    await thumb(page, 260);
    await expect(frame).toHaveText('Frame 1 of 2');

    // The notes are on the desk around the middle: the next one is up the left arm.
    const nextNote = win.locator('.fb-note[data-index="1"]');
    const note = await paper(page);
    expect((await nextNote.boundingBox())!.x).toBeLessThan(note.x);

    await page.reload();
    await openApp(page, 'flipbook');
    await expect(win.locator('.fb-frame')).toHaveText('Frame 1 of 2');
    await expect.poll(() => inkPixels(page)).toBeGreaterThan(20);
    expect(errors).toEqual([]);
  });

  test('onion view: the notes either side lie out as cards and show faintly under the one you draw on', async ({ page }) => {
    const { errors, win } = await setUp(page);
    await penLine(page, [0.2, 0.5], [0.4, 0.5]);
    await win.getByRole('button', { name: 'Next note' }).click();
    await penLine(page, [0.6, 0.5], [0.8, 0.5]);
    await win.getByRole('button', { name: 'Previous note' }).click();
    await expect(win.locator('.fb-frame')).toHaveText('Frame 1 of 2');
    const ghost = () =>
      page.locator('.fb-ink').evaluate((cv: HTMLCanvasElement) => {
        const ctx = cv.getContext('2d')!;
        const p = ctx.getImageData(Math.round(cv.width * 0.7), Math.round(cv.height * 0.5), 1, 1).data;
        return [p[0], p[1], p[2]];
      });
    const plain = await ghost();
    await win.getByRole('button', { name: 'Onion view' }).click();
    await expect(win.getByRole('button', { name: 'Onion view on' })).toHaveAttribute('aria-pressed', 'true');
    // The next note's line shows through, tinted blue-green.
    await expect.poll(async () => (await ghost())[0]).toBeLessThan(plain[0] - 20);
    // Its card lies flat to the side of the note you draw on (no flapping).
    const card = win.locator('.fb-note[data-index="1"]');
    await expect.poll(() => card.evaluate((el) => el.style.transform)).toMatch(/rotateX\(-?0(\.0+)?deg\) rotateY\(-?0(\.0+)?deg\)/);
    const note = await paper(page);
    const c = (await card.boundingBox())!;
    expect(c.x + c.width / 2).toBeLessThan(note.x + note.width / 2);
    expect(errors).toEqual([]);
  });

  test('plays, stops, undoes and redoes; More holds the note actions, speed and finger drawing', async ({ page }) => {
    const { errors, win } = await setUp(page);
    await penLine(page, [0.2, 0.2], [0.8, 0.8]);
    await win.getByRole('button', { name: 'Undo' }).click();
    expect(await inkPixels(page)).toBe(0);
    await win.getByRole('button', { name: 'Redo' }).click();
    await expect.poll(() => inkPixels(page)).toBeGreaterThan(20);

    await win.getByRole('button', { name: 'Play' }).click();
    await expect(win.locator('.fb-studio')).toHaveAttribute('data-playing', 'true');
    await expect(win.locator('.fb-ink')).not.toHaveAttribute('data-shown', 'true');
    await win.getByRole('button', { name: 'Stop' }).click();
    await expect(win.locator('.fb-ink')).toHaveAttribute('data-shown', 'true');

    await win.getByRole('button', { name: 'More' }).click();
    const sheet = page.getByRole('dialog', { name: 'Flipbook' });
    await sheet.getByRole('button', { name: '24 a second' }).click();
    await expect(sheet.getByRole('button', { name: '24 a second' })).toHaveAttribute('aria-pressed', 'true');
    await sheet.getByRole('switch').check();
    await sheet.getByRole('button', { name: 'Copy onto the next note' }).click();
    await expect(win.locator('.fb-frame')).toHaveText('Frame 2 of 2');
    await expect.poll(() => inkPixels(page)).toBeGreaterThan(20);

    // With finger drawing on, a finger on the note draws.
    const before = await inkPixels(page);
    const b = await paper(page);
    await fire(page, 'pointerdown', b.x + b.width * 0.1, b.y + b.height * 0.9, 'touch', 5);
    for (let i = 1; i <= 6; i++) await fire(page, 'pointermove', b.x + b.width * (0.1 + i * 0.05), b.y + b.height * 0.9, 'touch', 5);
    await fire(page, 'pointerup', b.x + b.width * 0.4, b.y + b.height * 0.9, 'touch', 5);
    await expect.poll(() => inkPixels(page)).toBeGreaterThan(before);

    await win.getByRole('button', { name: 'More' }).click();
    await page.getByRole('dialog', { name: 'Flipbook' }).getByRole('button', { name: 'Tear off this note' }).click();
    await expect(win.locator('.fb-frame')).toHaveText('Frame 1 of 1');
    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });
});

test.describe('Flipbook on iPhone', () => {
  test.beforeEach(({}, testInfo) => test.skip(isTablet(testInfo), 'the viewer is for iPhone'));

  test('is a viewer that says drawing happens on iPad', async ({ page }) => {
    const { errors, win } = await setUp(page);
    await expect(win.getByRole('heading', { name: 'Flipbook draws on iPad' })).toBeVisible();
    await expect(win.locator('.fb-desk')).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });
});
