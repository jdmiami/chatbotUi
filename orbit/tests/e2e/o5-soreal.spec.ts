import { expect, test, type Page } from '@playwright/test';
import { expectNoHorizontalOverflow } from './helpers';
import { mockAi } from './aiMocks';
import { mockMovies } from './soRealMocks';

/** Orbit 0.5 in soReal: the movies as a contents page, then one movie as a walk-through. */

async function openO5SoReal(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    if (!localStorage.getItem('orbit:shell:v1'))
      localStorage.setItem('orbit:shell:v1', JSON.stringify({ state: { settings: { orb: false, motion: 'reduce', motionPicked: true, skin: 'o5', introSeen: true } }, version: 0 }));
  });
  await page.goto('/');
  await page.getByRole('button', { name: /^Index/ }).click();
  await page.getByRole('dialog', { name: 'Index' }).getByRole('button', { name: /soReal/ }).click();
  const win = page.locator('.app-window[data-app="soreal"]');
  await expect(win.getByRole('heading', { name: 'Your movies' })).toBeVisible();
  return { errors, win };
}

async function expectTappable(page: Page) {
  const boxes = await page.locator('.app-window[data-app="soreal"] button:visible').evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { name: el.getAttribute('aria-label') || el.textContent?.trim() || '?', w: r.width, h: r.height };
    }),
  );
  for (const b of boxes) expect(Math.min(b.w, b.h), `${b.name} is big enough to tap`).toBeGreaterThanOrEqual(44);
}

test.describe('Orbit 0.5: soReal', () => {
  test('contents, then a movie walked through step by step', async ({ page }) => {
    await mockAi(page, 'on');
    const api = await mockMovies(page);
    const { errors, win } = await openO5SoReal(page);
    // One page at a time, even on iPad: no side list.
    await expect(win.locator('.sr-list')).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    await win.getByRole('button', { name: /Start a new movie/ }).click();

    for (const step of ['Name it, set the look', "How it's shot", 'Where it begins', 'The shots', 'Make it'])
      await expect(win.getByRole('heading', { name: step })).toBeVisible();
    await win.getByRole('textbox', { name: 'Title' }).fill('Night drive');
    await win.getByRole('textbox', { name: 'What happens in shot 1' }).fill('She gets in the car');
    await expectTappable(page);
    await expectNoHorizontalOverflow(page);

    // The last step is the end of the page, not a bar floating over the shots.
    await expect(win.locator('.sr-bar')).toHaveCSS('position', 'static');
    await win.getByRole('button', { name: 'Make the movie' }).click();
    await expect(win.locator('.sr-bar-text')).toHaveText('All shots made', { timeout: 15_000 });
    expect(api.calls.some((c) => c.method === 'PUT')).toBe(true);

    // Back to the contents: the movie is a line there.
    await win.getByRole('button', { name: 'All movies' }).click();
    await expect(win.getByRole('button', { name: /Night drive/ })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('typing hides everything but the words', async ({ page }) => {
    await mockAi(page, 'on');
    await mockMovies(page);
    const { errors, win } = await openO5SoReal(page);
    await win.getByRole('button', { name: /Start a new movie/ }).click();
    await win.getByRole('textbox', { name: 'Title' }).focus();
    // As on an iPhone with the keyboard up.
    await page.evaluate(() => (document.querySelector('.shell') as HTMLElement).setAttribute('data-keyboard', 'true'));
    await expect(win.locator('.app-header')).toHaveCSS('opacity', '0');
    expect(errors).toEqual([]);
  });
});
