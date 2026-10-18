import { expect, test, type Page } from '@playwright/test';
import { expectNoHorizontalOverflow, openOrbit } from './helpers';
import { mockAi, sse } from './aiMocks';
import { mockMovies, type Shot } from './soRealMocks';

/** soReal on iPhone / iPad viewports, with the AI machine's movie API mocked in memory. */

async function openSoReal(page: Page) {
  const win = page.locator('.app-window[data-app="soreal"]');
  const icon = page.getByRole('button', { name: /^soReal\./ });
  await expect(win.or(icon).first()).toBeVisible();
  if (!(await win.isVisible())) await icon.click();
  await expect(win.getByRole('heading', { name: 'soReal' })).toBeVisible();
  return win;
}

async function expectTappable(page: Page, min = 44) {
  const boxes = await page.locator('.app-window[data-app="soreal"] button:visible').evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { name: el.getAttribute('aria-label') || el.textContent?.trim() || '?', x: r.x, right: r.right, w: r.width, h: r.height };
    }),
  );
  const vw = page.viewportSize()!.width;
  for (const b of boxes) {
    expect(b.x, `${b.name} starts on screen`).toBeGreaterThanOrEqual(0);
    expect(b.right, `${b.name} ends on screen`).toBeLessThanOrEqual(vw + 1);
    expect(Math.min(b.w, b.h), `${b.name} is big enough to tap`).toBeGreaterThanOrEqual(min);
  }
}

test.describe('soReal', () => {
  test('off: asks to turn the AI machine on', async ({ page }) => {
    await mockAi(page, 'off');
    await mockMovies(page);
    const errors = await openOrbit(page);
    const win = await openSoReal(page);
    await expect(win.getByRole('status').filter({ hasText: 'soReal makes your movies on your AI machine' })).toBeVisible();
    await win.getByRole('button', { name: 'Turn on' }).click();
    await expect(win.getByRole('button', { name: 'New movie' }).first()).toBeEnabled();
    expect(errors).toEqual([]);
  });

  test('a movie: starts from the latest video, chains the shots, plays and exports', async ({ page }) => {
    await mockAi(page, 'on');
    const api = await mockMovies(page);
    const errors = await openOrbit(page);
    const win = await openSoReal(page);
    await win.getByRole('button', { name: 'New movie' }).first().click();
    // A new movie picks up from the newest video in the gallery.
    await expect(win.getByText('The last frame of “a woman walks to the car”')).toBeVisible();
    expect(api.calls.find((c) => c.method === 'POST' && c.path === '')!.body).toMatchObject({ start: 'newvid1' });

    await win.getByRole('textbox', { name: 'Title' }).fill('Night drive');
    await win.getByRole('textbox', { name: 'Look and characters' }).fill('A woman in a red coat, neon city');
    await win.getByRole('textbox', { name: 'What happens in shot 1' }).fill('She gets in the car');
    await win.getByRole('button', { name: 'Add shot' }).click();
    await win.getByRole('textbox', { name: 'What happens in shot 2' }).fill('The car pulls away');
    await expect(win.getByText('picks up from the last frame')).toHaveCount(2);
    await expectNoHorizontalOverflow(page);
    await expectTappable(page);

    await win.getByRole('button', { name: 'Make the movie' }).click();
    const put = api.calls.filter((c) => c.method === 'PUT').pop()!;
    expect(put.body).toMatchObject({ title: 'Night drive', look: 'A woman in a red coat, neon city', start: 'newvid1' });
    expect((put.body as { shots: Shot[] }).shots.map((s) => s.prompt)).toEqual(['She gets in the car', 'The car pulls away']);
    await expect(win.getByRole('button', { name: 'Stop' })).toBeVisible();
    await expect(win.locator('.sr-bar-text')).toHaveText('All shots made', { timeout: 15_000 });
    await expect(win.locator('.sr-badge-done')).toHaveCount(2);

    await win.getByRole('button', { name: 'Watch' }).click();
    const watch = page.getByRole('dialog', { name: 'Night drive' });
    await expect(watch.getByText('Shot 1 of 2')).toBeVisible();
    await watch.getByRole('button', { name: /Close/ }).first().click();

    await win.getByRole('button', { name: 'Export' }).click();
    await expect(page.getByRole('dialog', { name: 'Night drive' }).getByRole('link', { name: 'Save' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('plan with AI writes the shots from an idea', async ({ page }) => {
    await mockAi(page, 'on');
    await mockMovies(page);
    await page.route('**/fake-ai/v1/chat/completions', (route) =>
      route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: sse('["A courier grabs the box.", "She sprints through rain.", "She reaches the door at midnight."]') }),
    );
    const errors = await openOrbit(page);
    const win = await openSoReal(page);
    await win.getByRole('button', { name: 'New movie' }).first().click();
    await win.getByRole('button', { name: 'Plan with AI' }).click();
    const sheet = page.getByRole('dialog', { name: 'Plan with AI' });
    await sheet.getByRole('textbox').fill('A courier races to deliver a box before midnight');
    await sheet.getByRole('button', { name: 'Write the shots' }).click();
    await expect(sheet.getByText('She sprints through rain.')).toBeVisible();
    await sheet.getByRole('button', { name: 'Use these shots' }).click();
    await expect(win.getByRole('textbox', { name: 'What happens in shot 3' })).toHaveValue('She reaches the door at midnight.');
    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });

  test('helper machine: turn it on and make a movie there while the main machine stays free', async ({ page }) => {
    await mockAi(page, 'on');
    const api = await mockMovies(page);
    let helper = 'off';
    const helperCalls: string[] = [];
    await page.route('**/api/ai/helper', async (route) => {
      if (route.request().method() === 'POST') {
        helperCalls.push(route.request().postDataJSON().action);
        helper = 'on';
      }
      await route.fulfill({ json: { state: helper, costPerHour: helper === 'on' ? 0.59 : null, pricePerHour: 0.59, idle: { limitMinutes: 30, idleMinutes: 0 } } });
    });
    await page.route('**/api/ai/token', (route) =>
      route.fulfill({
        json: { url: new URL('/fake-ai', page.url()).href, helperUrl: helper === 'on' ? new URL('/fake-helper', page.url()).href : null, token: 'test', expiresIn: 3600 },
      }),
    );
    const onHelper: string[] = [];
    await page.route('**/fake-helper/_orbit/studio/movies/*/run', async (route) => {
      onHelper.push(route.request().url());
      const id = /movies\/([^/]+)\/run/.exec(route.request().url())![1];
      const m = api.movies.get(id)!;
      Object.assign(m, { running: true, runningOn: 'helper' });
      m.shots[0].status = 'making';
      await route.fulfill({ json: m });
    });
    const errors = await openOrbit(page);
    const win = await openSoReal(page);
    const bar = win.getByRole('status', { name: 'Helper machine' });
    await expect(bar).toContainText('Turn it on to make two movies at once ($0.59/h while on)');
    await bar.getByRole('button', { name: 'Turn on helper' }).click();
    await expect(bar).toContainText('Helper machine: on');
    expect(helperCalls).toEqual(['start']);

    await win.getByRole('button', { name: 'New movie' }).first().click();
    await win.getByRole('textbox', { name: 'What happens in shot 1' }).fill('Waves roll in');
    await win.getByRole('group', { name: 'Make on' }).getByRole('button', { name: 'Helper' }).click();
    await expectNoHorizontalOverflow(page);
    await expectTappable(page);
    await win.getByRole('button', { name: 'Make the movie' }).click();
    await expect.poll(() => onHelper.length).toBe(1);
    await expect(win.locator('.sr-bar-text')).toContainText('on the helper');
    expect(errors).toEqual([]);
  });
});
