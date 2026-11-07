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
    await sheet.getByRole('switch', { name: /Draw with a finger/ }).check();
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

test.describe('Flipbook characters (stage 2) on iPad', () => {
  test.beforeEach(({}, testInfo) => test.skip(!isTablet(testInfo), 'drawing is on iPad'));

  /** A pen stroke on any element, in its own units. */
  async function penOn(page: Page, selector: string, pts: [number, number][]) {
    const b = (await page.locator(selector).boundingBox())!;
    const at = (u: number, v: number) => [b.x + u * b.width, b.y + v * b.height] as const;
    const send = (type: string, x: number, y: number) =>
      page.evaluate(
        ([sel, type, x, y]) =>
          document.querySelector(sel as string)!.dispatchEvent(new PointerEvent(type as string, { clientX: x as number, clientY: y as number, pointerType: 'pen', pointerId: 11, bubbles: true, isPrimary: true, pressure: 0.6, buttons: 1 })),
        [selector, type, x, y] as const,
      );
    await send('pointerdown', ...at(...pts[0]));
    for (const p of pts.slice(1)) await send('pointermove', ...at(...p));
    await send('pointerup', ...at(...pts[pts.length - 1]));
  }
  const circle = (cx: number, cy: number, r: number) => Array.from({ length: 25 }, (_, k) => [cx + r * Math.cos((k / 24) * 6.283), cy + r * Math.sin((k / 24) * 6.283)] as [number, number]);
  const joints = async (page: Page) => JSON.parse((await page.locator('.fb-ink').getAttribute('data-joints')) ?? '[]') as { id: string; x: number; y: number }[];

  async function makeCharacter(page: Page, name: string) {
    const win = page.locator('.app-window[data-app="flipbook"]');
    await win.getByRole('button', { name: 'Characters' }).click();
    const sheet = page.getByRole('dialog', { name: 'Characters' });
    await sheet.getByLabel("New character's name").fill(name);
    await sheet.getByRole('button', { name: 'Make it and start drawing' }).click();
    const walk = page.getByRole('dialog', { name: `Drawing ${name}` });
    await expect(walk).toBeVisible();
    return { win, walk };
  }

  test('make a character, draw its head in the walkthrough, skip the rest: it stands on the note as sticks with a drawn head', async ({ page }) => {
    const { errors } = await setUp(page);
    const { win, walk } = await makeCharacter(page, 'Jumpy');
    await expect(walk.getByRole('heading', { name: 'Head' })).toBeVisible();
    await expect(walk.getByText('part 1 of 17')).toBeVisible();
    await penOn(page, '.fb-walk-note', circle(0.5, 0.5, 0.15));
    await expect(walk.getByText('1 of 15 body parts drawn')).toBeVisible();
    await expect(walk.getByRole('button', { name: /Head/ }).first()).toHaveAttribute('data-done', 'true');
    await walk.getByRole('button', { name: 'Next part' }).click();
    await expect(walk.getByRole('heading', { name: 'Chest' })).toBeVisible();
    await walk.getByRole('button', { name: 'Skip, keep a stick' }).click();
    await expect(walk.getByRole('heading', { name: 'Hips' })).toBeVisible();
    await walk.getByRole('button', { name: 'Done for now' }).click();
    await expect(walk).toHaveCount(0);
    // The figure is on the note now, and the pose tool is picked.
    await expect(win.getByRole('button', { name: 'Pose the character' })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => inkPixels(page)).toBeGreaterThan(30);
    await expect(win.getByRole('button', { name: 'Character: Jumpy' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('pose with the pen: drag a hand and the arm bends to reach; the next note holds the pose; undo; it keeps after a reload', async ({ page }) => {
    const { errors } = await setUp(page);
    const { win, walk } = await makeCharacter(page, 'Posey');
    await walk.getByRole('button', { name: 'Done for now' }).click();
    const before = await joints(page);
    const hand = before.find((j) => j.id === 'forearmR')!;
    expect(hand).toBeTruthy();
    // Drag the right wrist up and out.
    const b = await paper(page);
    const toScreen = (x: number, y: number) => [b.x + x * b.width, b.y + y * b.height] as const;
    await fire(page, 'pointerdown', ...toScreen(hand.x, hand.y), 'pen', 12);
    for (let i = 1; i <= 6; i++) await fire(page, 'pointermove', ...toScreen(hand.x + i * 0.02, hand.y - i * 0.05), 'pen', 12);
    await fire(page, 'pointerup', ...toScreen(hand.x + 0.12, hand.y - 0.3), 'pen', 12);
    await expect.poll(async () => (await joints(page)).find((j) => j.id === 'forearmR')!.y).toBeLessThan(hand.y - 0.2);
    const posed = (await joints(page)).find((j) => j.id === 'forearmR')!;
    // The shoulder did not move; the hips did not move.
    expect((await joints(page)).find((j) => j.id === 'move')).toEqual(before.find((j) => j.id === 'move'));
    // The next (blank) note holds the same pose.
    await win.getByRole('button', { name: 'Next note' }).click();
    await expect(win.locator('.fb-frame')).toHaveText('New note · 1 so far');
    expect((await joints(page)).find((j) => j.id === 'forearmR')).toEqual(posed);
    await win.getByRole('button', { name: 'Previous note' }).click();
    // Undo puts the arm back down.
    await win.getByRole('button', { name: 'Undo' }).click();
    await expect.poll(async () => (await joints(page)).find((j) => j.id === 'forearmR')!.y).toBeCloseTo(hand.y, 3);
    await win.getByRole('button', { name: 'Redo' }).click();
    await page.waitForTimeout(700);
    await page.reload();
    const again = await openApp(page, 'flipbook');
    await again.getByRole('button', { name: 'Pose the character' }).click();
    await expect.poll(async () => (await joints(page)).find((j) => j.id === 'forearmR')?.y ?? 1).toBeLessThan(hand.y - 0.2);
    await expect(again.getByRole('button', { name: 'Character: Posey' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('eyes and mouths: two looks of eyes, and each note picks which shows', async ({ page }) => {
    const { errors } = await setUp(page);
    const { win, walk } = await makeCharacter(page, 'Face');
    await walk.getByRole('button', { name: 'Eyes', exact: true }).click();
    await expect(walk.getByRole('heading', { name: 'Eyes' })).toBeVisible();
    await penOn(page, '.fb-walk-note', [[0.42, 0.45], [0.46, 0.45]]);
    await walk.getByRole('button', { name: '+ Another look' }).click();
    await expect(walk.getByRole('button', { name: 'Look 2' })).toHaveAttribute('aria-pressed', 'true');
    await penOn(page, '.fb-walk-note', [[0.42, 0.42], [0.46, 0.48]]);
    await walk.getByRole('button', { name: 'Done for now' }).click();
    const pick = win.getByRole('group', { name: 'Face on this note' });
    await expect(pick.getByRole('button', { name: 'Eyes 1/2' })).toBeVisible();
    await pick.getByRole('button', { name: 'Eyes 1/2' }).click();
    await expect(pick.getByRole('button', { name: 'Eyes 2/2' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('detail levels: Full adds every finger joint and the toes to the walkthrough; drawn parts are kept', async ({ page }) => {
    const { errors } = await setUp(page);
    const { win, walk } = await makeCharacter(page, 'Detail');
    await penOn(page, '.fb-walk-note', circle(0.5, 0.5, 0.15));
    await walk.getByRole('button', { name: 'Done for now' }).click();
    await win.getByRole('button', { name: 'Character: Detail' }).click();
    const sheet = page.getByRole('dialog', { name: 'Detail' });
    await expect(sheet.getByText('Simple · 1 of 15 parts drawn')).toBeVisible();
    await sheet.getByRole('group', { name: 'Skeleton detail' }).first().getByRole('button', { name: 'Full' }).click();
    await expect(sheet.getByText('Full · 1 of 51 parts drawn')).toBeVisible();
    await sheet.getByRole('button', { name: 'Keep drawing its parts' }).click();
    const again = page.getByRole('dialog', { name: 'Drawing Detail' });
    await expect(again.getByText('part 2 of 53')).toBeVisible();
    await expect(again.getByRole('button', { name: 'Thumb base, left' })).toBeVisible();
    await expect(again.getByRole('button', { name: 'Toes, right' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });
});

test.describe('Flipbook menu bar and action moves on iPad', () => {
  test.beforeEach(({}, testInfo) => test.skip(!isTablet(testInfo), 'drawing is on iPad'));

  const menu = async (page: Page, name: string, item: RegExp | string) => {
    await page.getByRole('menubar', { name: 'Flipbook menu' }).getByRole('menuitem', { name, exact: true }).click();
    await page.getByRole('menu', { name }).getByRole('menuitem', { name: item }).click();
  };

  test('File, Edit, View, Frame, Character, Play and Help are along the top; Save says Saved', async ({ page }) => {
    const { errors, win } = await setUp(page);
    const bar = win.getByRole('menubar', { name: 'Flipbook menu' });
    for (const m of ['File', 'Edit', 'View', 'Frame', 'Character', 'Play', 'Help']) await expect(bar.getByRole('menuitem', { name: m, exact: true })).toBeVisible();
    await penLine(page, [0.2, 0.5], [0.8, 0.5]);
    await expect(win.locator('.fb-title-status')).toHaveText('Saved');
    await menu(page, 'File', /^Save (Saved|Saving…)$/);
    await expect(page.getByText('Saved on this iPad.')).toBeVisible();
    await menu(page, 'Help', 'Gestures and shortcuts');
    await expect(page.getByRole('dialog', { name: 'Gestures and shortcuts' }).getByText('Two-finger tap')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });

  test('versions, start over and new flipbooks: nothing is lost', async ({ page }) => {
    const { errors, win } = await setUp(page);
    await penLine(page, [0.2, 0.5], [0.8, 0.5]);
    await menu(page, 'File', 'Save a version…');
    await page.getByRole('dialog', { name: 'Save a version' }).getByRole('button', { name: 'Save version' }).click();
    await expect(page.getByText(/Version saved/)).toBeVisible();
    // Start over asks first, then wipes everything back to one blank note.
    await menu(page, 'File', 'Start over…');
    await page.getByRole('dialog', { name: 'Start over?' }).getByRole('button', { name: 'Start over' }).click();
    await expect(win.locator('.fb-frame')).toHaveText('Frame 1 of 1');
    await expect.poll(() => inkPixels(page)).toBe(0);
    // Back to the saved version.
    await menu(page, 'File', 'Versions…');
    await page.getByRole('dialog', { name: 'Versions' }).getByRole('button', { name: 'Go back to this' }).click();
    await expect.poll(() => inkPixels(page)).toBeGreaterThan(20);
    // A new flipbook, then open the first one again.
    await menu(page, 'File', 'New flipbook');
    await expect(win.locator('.fb-title-name')).toHaveText('Flipbook 2');
    await expect.poll(() => inkPixels(page)).toBe(0);
    await menu(page, 'File', 'Open…');
    const open = page.getByRole('dialog', { name: 'Open a flipbook' });
    await open.getByRole('listitem').filter({ hasText: 'My flipbook' }).getByRole('button', { name: 'Open' }).click();
    await expect(win.locator('.fb-title-name')).toHaveText('My flipbook');
    await expect.poll(() => inkPixels(page)).toBeGreaterThan(20);
    expect(errors).toEqual([]);
  });

  test('Edit: copy a note and paste it over another; a two-finger tap undoes', async ({ page }) => {
    const { errors, win } = await setUp(page);
    await penLine(page, [0.2, 0.5], [0.8, 0.5]);
    await menu(page, 'Edit', 'Copy this note');
    await win.getByRole('button', { name: 'Next note' }).click();
    await expect.poll(() => inkPixels(page)).toBe(0);
    await menu(page, 'Edit', 'Paste over this note');
    await expect(win.locator('.fb-frame')).toHaveText('Frame 2 of 2');
    await expect.poll(() => inkPixels(page)).toBeGreaterThan(20);
    // Two fingers tap the desk together: undo the paste.
    const b = await paper(page);
    await fire(page, 'pointerdown', b.x + 100, b.y + 100, 'touch', 21);
    await fire(page, 'pointerdown', b.x + 160, b.y + 100, 'touch', 22);
    await fire(page, 'pointerup', b.x + 100, b.y + 100, 'touch', 21);
    await fire(page, 'pointerup', b.x + 160, b.y + 100, 'touch', 22);
    await expect(page.getByText('Undone (two-finger tap).')).toBeVisible();
    await expect.poll(() => inkPixels(page)).toBe(0);
    expect(errors).toEqual([]);
  });

  test('action moves: a backflip from the Action Pack goes onto the notes, with a stick character made for it', async ({ page }) => {
    const { errors, win } = await setUp(page);
    await menu(page, 'Character', 'Action moves…');
    const sheet = page.getByRole('dialog', { name: 'Action moves' });
    await expect(sheet.getByRole('tab', { name: 'Flips' })).toBeVisible();
    await sheet.getByRole('button', { name: /^Backflip/ }).click();
    const put = sheet.getByRole('button', { name: /Put it on notes 1 to \d+/ });
    const label = (await put.textContent()) ?? '';
    const last = Number(/to (\d+)/.exec(label)![1]);
    expect(last).toBeGreaterThan(10);
    await put.click();
    await expect(win.locator('.fb-frame')).toHaveText(`Frame 1 of ${last}`);
    await expect(win.getByRole('button', { name: 'Character: Stick' })).toBeVisible();
    await expect.poll(() => inkPixels(page)).toBeGreaterThan(30);
    // Kicks are there too; credit to the motion library.
    await menu(page, 'Character', 'Action moves…');
    await page.getByRole('dialog', { name: 'Action moves' }).getByRole('tab', { name: 'Kicks' }).click();
    await expect(page.getByRole('dialog', { name: 'Action moves' }).getByRole('button', { name: /Jump kick/ })).toBeVisible();
    await expect(page.getByText(/CMU Graphics Lab Motion Capture Database/)).toBeVisible();
    expect(errors).toEqual([]);
  });
});
