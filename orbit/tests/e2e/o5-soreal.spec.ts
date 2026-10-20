import { expect, test, type Page } from '@playwright/test';
import { expectNoHorizontalOverflow } from './helpers';
import { mockAi } from './aiMocks';
import { mockMovies } from './soRealMocks';

/** Orbit 0.5 in soReal: the magazine look, and the walkthrough with the orb as the guide. */

async function openO5SoReal(page: Page, { orb = false } = {}) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((orbOn) => {
    if (!localStorage.getItem('orbit:shell:v1'))
      localStorage.setItem('orbit:shell:v1', JSON.stringify({ state: { settings: { orb: orbOn, motion: 'reduce', motionPicked: true, skin: 'o5', introSeen: true } }, version: 0 }));
  }, orb);
  await page.goto('/');
  await page.getByRole('button', { name: /^Index/ }).click();
  await page.getByRole('dialog', { name: 'Index' }).getByRole('button', { name: /soReal/ }).click();
  const win = page.locator('.app-window[data-app="soreal"]');
  await expect(win.getByRole('heading', { name: 'What’s your movie about?' })).toBeVisible();
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
  test('the start reads like the magazine, and Make goes straight to the movie', async ({ page }) => {
    await mockAi(page, 'on');
    const api = await mockMovies(page);
    const { errors, win } = await openO5SoReal(page);
    // The display face, quick starts, and the movies as contents lines.
    await expect(win.locator('.sr-display')).toHaveCSS('font-family', /Fraunces/);
    for (const t of ['Trailer', 'Music video', 'Ad', 'Story', 'Comedy']) await expect(win.getByRole('group', { name: 'Quick starts' }).getByRole('button', { name: t })).toBeVisible();
    await win.getByRole('button', { name: 'Trailer' }).click();
    await expect(win.getByRole('group', { name: 'Length' }).getByRole('button', { name: '30 s' })).toHaveAttribute('aria-pressed', 'true');
    await expectNoHorizontalOverflow(page);
    await expectTappable(page);
    await win.getByRole('button', { name: 'Make', exact: true }).click();
    expect(api.calls.find((c) => c.method === 'POST' && c.path === '')!.body).toMatchObject({ template: 'trailer', length: 30, size: 'portrait' });
    await expect(win.getByText('Your movie is ready')).toBeVisible({ timeout: 40_000 });
    await expect(win.locator('.sr-shot')).toHaveCount(6);
    await expectNoHorizontalOverflow(page);
    await expectTappable(page);
    await win.getByRole('button', { name: 'All movies' }).click();
    await expect(win.getByRole('button', { name: /Kite Day/ })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('walk me through it: on each step the orb goes to it and says its line', async ({ page }) => {
    await mockAi(page, 'on');
    await mockMovies(page);
    const { errors, win } = await openO5SoReal(page, { orb: true });
    await win.getByRole('textbox', { name: 'What’s your movie about?' }).fill('A kite on a windy hill');
    await win.getByRole('button', { name: 'Walk me through it' }).click();
    const caption = page.locator('.orb-caption');
    await expect(caption).toHaveText('Say what your movie is about in a sentence. Skip it and I’ll pick an idea.');
    // It flies beside the line it is saying.
    await expect
      .poll(async () => {
        const orb = await page.locator('.orb-layer button').first().boundingBox();
        const line = await win.locator('.sr-guide').boundingBox();
        return Boolean(orb && line && Math.abs(orb.y + orb.height / 2 - (line.y + line.height / 2)) < 120);
      })
      .toBe(true);
    await win.getByRole('button', { name: 'Skip', exact: true }).click();
    await expect(caption).toHaveText('Pick how long and which way up. Skip to keep it as it is.');
    await win.getByRole('button', { name: 'Next' }).click();
    await expect(caption).toHaveText('Here is the story, one line per shot. Change any line, or skip and keep mine.');
    await expect(win.getByRole('textbox', { name: 'Shot 1' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await win.getByRole('button', { name: 'Skip to the end' }).click();
    await expect(caption).toHaveText('All set. Here is how long it takes. Your phone can sleep meanwhile.');
    await expect(win.getByRole('button', { name: 'Make my movie' })).toBeEnabled();
    expect(errors).toEqual([]);
  });

  test('typing hides everything but the words', async ({ page }) => {
    await mockAi(page, 'on');
    await mockMovies(page);
    const { errors, win } = await openO5SoReal(page);
    await win.getByRole('textbox', { name: 'What’s your movie about?' }).focus();
    // As on an iPhone with the keyboard up.
    await page.evaluate(() => (document.querySelector('.shell') as HTMLElement).setAttribute('data-keyboard', 'true'));
    await expect(win.locator('.app-header')).toHaveCSS('opacity', '0');
    expect(errors).toEqual([]);
  });
});
