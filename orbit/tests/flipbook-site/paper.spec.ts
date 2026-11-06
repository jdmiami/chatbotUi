import { expect, test, type Page } from '@playwright/test';

/**
 * Round 1: the bending paper (WebGL2, in software here) and riffling. Motion is on (Full) for these.
 * Chromium with emulated iPads: the feel with a real Pencil and finger is checked on the device.
 */
test.use({ contextOptions: { reducedMotion: 'no-preference' } });
test.beforeEach(({}, info) => test.skip(!info.project.name.startsWith('ipad'), 'drawing is on iPad'));

async function open(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    if (!localStorage.getItem('orbit:shell:v1'))
      localStorage.setItem('orbit:shell:v1', JSON.stringify({ state: { settings: { orb: false, motion: 'full', motionPicked: true, introSeen: true } }, version: 0 }));
  });
  await page.goto('/');
  await expect(page.locator('.fb-studio')).toHaveAttribute('data-gl', 'true', { timeout: 10_000 });
  return errors;
}
const fire = (page: Page, type: string, x: number, y: number, pointerType: string, id: number) =>
  page.evaluate(
    ([type, x, y, pointerType, id]) =>
      document.querySelector('.fb-desk')!.dispatchEvent(new PointerEvent(type as string, { clientX: x as number, clientY: y as number, pointerType: pointerType as string, pointerId: id as number, bubbles: true, isPrimary: true, pressure: 0.6, buttons: 1 })),
    [type, x, y, pointerType, id] as const,
  );
const glNotes = (page: Page) => page.locator('.fb-gl').evaluate((c) => Number((c as HTMLElement).dataset.notes ?? 0));
const glPos = (page: Page) => page.locator('.fb-gl').evaluate((c) => Number((c as HTMLElement).dataset.pos ?? 0));

/** A pad of `n` frames: one pen line, copied onto each next note. Back to the first. */
async function pad(page: Page, n: number) {
  const b = (await page.locator('.fb-ink').boundingBox())!;
  await fire(page, 'pointerdown', b.x + b.width * 0.3, b.y + b.height * 0.5, 'pen', 9);
  await fire(page, 'pointermove', b.x + b.width * 0.7, b.y + b.height * 0.5, 'pen', 9);
  await fire(page, 'pointerup', b.x + b.width * 0.7, b.y + b.height * 0.5, 'pen', 9);
  const landed = () => expect(page.locator('.fb-ink')).toHaveAttribute('data-shown', 'true', { timeout: 15_000 });
  for (let k = 1; k < n; k++) {
    await landed();
    await page.getByRole('button', { name: 'More' }).click();
    await page.getByRole('dialog', { name: 'Flipbook' }).getByRole('button', { name: 'Copy onto the next note' }).click();
    await expect(page.locator('.fb-frame')).toHaveText(`Frame ${k + 1} of ${k + 1}`, { timeout: 10_000 });
  }
  // Back to the first note, one at a time (each lands before the next).
  for (let k = n - 1; k >= 1; k--) {
    await landed();
    await page.getByRole('button', { name: 'Previous note' }).click();
    await expect(page.locator('.fb-frame')).toHaveText(`Frame ${k} of ${n}`, { timeout: 10_000 });
  }
  return b;
}

test('the paper is drawn on the graphics chip: every note on the desk is a sheet', async ({ page }) => {
  const errors = await open(page);
  await expect.poll(() => glNotes(page)).toBeGreaterThan(0);
  // The flat desk's notes are gone; the sharp drawing canvas still lies over the middle note.
  await expect(page.locator('.fb-note')).toHaveCount(0);
  await expect(page.locator('.fb-ink')).toHaveAttribute('data-shown', 'true');
  expect(errors).toEqual([]);
});

test('a quick flick riffles, keeps going after letting go, then lands on a note', async ({ page }) => {
  const errors = await open(page);
  const b = await pad(page, 8);
  const x = 14;
  const y = b.y + b.height * 0.6;
  // About a note in a twelfth of a second: a riffle, but not the hard flick that keeps it playing.
  await fire(page, 'pointerdown', x, y, 'touch', 3);
  // A note is a third of the paper's width of swipe; this is about one and a half notes.
  const step = (b.width * 0.36 * 1.5) / 5;
  for (let k = 1; k <= 5; k++) {
    await fire(page, 'pointermove', x, y - k * step, 'touch', 3);
    await page.waitForTimeout(16);
  }
  await fire(page, 'pointerup', x, y - 5 * step, 'touch', 3);
  const atRelease = await glPos(page);
  // It keeps going on its own after the thumb has gone…
  await expect.poll(() => glPos(page), { timeout: 5000 }).toBeGreaterThan(atRelease + 0.2);
  // …and lands on a whole note.
  await expect(page.locator('.fb-ink')).toHaveAttribute('data-shown', 'true', { timeout: 15_000 });
  await expect(page.locator('.fb-frame')).not.toHaveText('Frame 1 of 8');
  await expect(page.locator('.fb-studio')).not.toHaveAttribute('data-playing', 'true');
  expect(errors).toEqual([]);
});

test('the corner handle: hold the note\'s corner and push, and the pad riffles on its own', async ({ page }) => {
  const errors = await open(page);
  const b = await pad(page, 6);
  const cx = b.x + b.width - 8;
  const cy = b.y + b.height - 8;
  await fire(page, 'pointerdown', cx, cy, 'touch', 5);
  for (let k = 1; k <= 4; k++) await fire(page, 'pointermove', cx + k * 30, cy, 'touch', 5);
  await expect(page.getByRole('status').filter({ hasText: /Riffling/ })).toBeVisible();
  await expect.poll(() => glPos(page), { timeout: 5000 }).toBeGreaterThan(1.5);
  await fire(page, 'pointerup', cx + 120, cy, 'touch', 5);
  await expect(page.locator('.fb-ink')).toHaveAttribute('data-shown', 'true', { timeout: 15_000 });
  await expect(page.getByRole('status').filter({ hasText: /Riffling/ })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('paper picker and paper sounds: each flipbook keeps its paper; the sound switch is remembered', async ({ page }) => {
  const errors = await open(page);
  await page.getByRole('button', { name: 'More' }).click();
  const sheet = page.getByRole('dialog', { name: 'Flipbook' });
  await sheet.getByRole('button', { name: 'Lined' }).click();
  await expect(page.locator('.fb-studio')).toHaveAttribute('data-paper', 'lined');
  const sound = sheet.getByRole('switch', { name: /Paper sounds/ });
  await expect(sound).toBeChecked();
  await sound.uncheck();
  await page.waitForTimeout(600);
  await page.reload();
  await expect(page.locator('.fb-studio')).toHaveAttribute('data-paper', 'lined', { timeout: 10_000 });
  await page.getByRole('button', { name: 'More' }).click();
  await expect(page.getByRole('dialog', { name: 'Flipbook' }).getByRole('switch', { name: /Paper sounds/ })).not.toBeChecked();
  expect(errors).toEqual([]);
});
